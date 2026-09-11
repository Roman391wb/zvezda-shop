import { constantTimeEqual, randomToken, sha256 } from "./crypto";
import { AppError, unauthorized } from "./errors";
import { parseCookies } from "./http";
import type { CurrentSession } from "./types";
import type { AdminStore } from "./store";

const SESSION_TTL_MS = 12 * 60 * 60_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export async function requestHash(value: string, pepper?: string): Promise<string | null> {
  return pepper ? sha256(`${pepper}:${value}`) : null;
}

export async function newSession(store: AdminStore, userId: string, sessionVersion: number, request: Request, pepper?: string): Promise<{ cookieValue: string; csrfToken: string }> {
  const id = crypto.randomUUID();
  const secret = randomToken();
  const csrfToken = randomToken();
  const now = Date.now();
  await store.createSession({
    id, userId, secretHash: await sha256(secret), csrfHash: await sha256(csrfToken), sessionVersion,
    createdAt: now, expiresAt: now + SESSION_TTL_MS,
    ipHash: await requestHash(clientIp(request), pepper),
    userAgentHash: await requestHash(request.headers.get("User-Agent") ?? "", pepper)
  });
  return { cookieValue: `${id}.${secret}`, csrfToken };
}

export async function currentSession(store: AdminStore, request: Request): Promise<CurrentSession> {
  const raw = parseCookies(request).get("za_admin_session");
  const [id, secret, ...extra] = raw?.split(".") ?? [];
  if (!id || !secret || extra.length) throw unauthorized();
  const session = await store.findSession(id);
  if (!session || session.revokedAt || session.expiresAt <= Date.now() || !await constantTimeEqual(await sha256(secret), session.secretHash)) throw unauthorized();
  const user = await store.findUserById(session.userId);
  if (!user || !user.isActive || user.sessionVersion !== session.sessionVersion) throw unauthorized();
  const csrfToken = parseCookies(request).get("za_admin_csrf") ?? "";
  if (!csrfToken || !await constantTimeEqual(await sha256(csrfToken), session.csrfHash)) throw unauthorized();
  if (Date.now() - session.lastSeenAt > TOUCH_INTERVAL_MS) await store.touchSession(session.id, Date.now());
  return { user, session, csrfToken };
}

export async function enforceCsrf(session: CurrentSession, request: Request): Promise<void> {
  const token = request.headers.get("X-CSRF-Token");
  if (!token || !session.csrfToken || !await constantTimeEqual(token, session.csrfToken) || !await constantTimeEqual(await sha256(token), session.session.csrfHash)) throw new AppError(403, "csrf_failed", "Проверка CSRF не пройдена");
}
