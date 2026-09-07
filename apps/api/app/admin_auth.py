from dataclasses import dataclass
from collections import defaultdict, deque
from ipaddress import ip_address, ip_network
from time import monotonic
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .models import AdminAuditLog, AdminRole, AdminUser
from .permissions import Permission, has_permission


_login_attempts: dict[str, deque[float]] = defaultdict(deque)
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS = 8


@dataclass(frozen=True)
class CurrentAdmin:
    user: AdminUser


def client_ip(request: Request) -> str:
    """Accept forwarding headers only from the configured internal proxy network."""
    remote = request.client.host if request.client else "unknown"
    try:
        trusted = [ip_network(value.strip()) for value in settings.trusted_proxy_cidrs.split(",") if value.strip()]
        if trusted and any(ip_address(remote) in network for network in trusted):
            forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            if forwarded:
                return forwarded
    except ValueError:
        # A malformed optional proxy list must never make arbitrary forwarding trusted.
        pass
    return remote


def enforce_login_rate_limit(request: Request) -> None:
    ip = client_ip(request)
    now = monotonic()
    attempts = _login_attempts[ip]
    while attempts and now - attempts[0] > LOGIN_WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Слишком много попыток входа. Попробуйте позже.")
    attempts.append(now)


def clear_login_attempts(request: Request) -> None:
    _login_attempts.pop(client_ip(request), None)


async def current_admin(request: Request, session: AsyncSession = Depends(get_session)) -> CurrentAdmin:
    raw_user_id = request.session.get("admin_user_id")
    session_version = request.session.get("session_version")
    try:
        user_id = UUID(str(raw_user_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация администратора")
    user = await session.get(AdminUser, user_id)
    if user is None or not user.is_active or user.session_version != session_version:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия недействительна")
    return CurrentAdmin(user=user)


def require_permission(permission: Permission):
    async def dependency(request: Request, current: CurrentAdmin = Depends(current_admin), session: AsyncSession = Depends(get_session)) -> CurrentAdmin:
        if not has_permission(current.user.role, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not request.url.path.startswith("/api/admin/users"):
            add_audit(session, current.user, f"{request.method} {request.url.path}", metadata={"permission": permission.value})
            await session.commit()
        return current
    return dependency


def require_role(role: AdminRole):
    async def dependency(current: CurrentAdmin = Depends(current_admin)) -> CurrentAdmin:
        if current.user.role != role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Раздел доступен только ADMIN")
        return current
    return dependency


def add_audit(session: AsyncSession, actor: AdminUser | None, action: str, target_user_id: UUID | None = None, metadata: dict | None = None) -> None:
    session.add(AdminAuditLog(actor_user_id=actor.id if actor else None, target_user_id=target_user_id, action=action, metadata_json=metadata))
