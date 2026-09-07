import io
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

import bcrypt
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import Text, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .admin_auth import CurrentAdmin, add_audit, clear_login_attempts, current_admin, enforce_login_rate_limit, require_permission
from .admin_schemas import AdminLoginIn, AttributeIn, DiscountIn, HomepageSectionIn, MediaUpdateIn, ModeratorCreateIn, ModeratorUpdateIn, PasswordResetIn, ProductIn, TaxonomyIn, VariantIn
from .config import settings
from .db import get_session
from .models import AdminAuditLog, AdminRole, AdminUser, Category, Collection, CollectionProduct, Discount, HomepageRevision, HomepageSection, InventoryMovement, MediaAsset, Order, OrderItem, OrderStatus, OrderStatusHistory, Product, ProductAttributeDefinition, ProductAttributeValue, ProductMedia, ProductStatus, ProductVariant, StoreSettings
from .permissions import Permission, permissions_for
from .schemas import AttributeOut, HomepageSectionOut, MediaOut, ProductCardOut, ProductOut, VariantOut

router = APIRouter(prefix="/api/admin", tags=["admin"])
Session = Depends(get_session)
ALLOWED_IMAGES = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}
ALLOWED_VIDEOS = {"video/mp4": ".mp4", "video/webm": ".webm"}


def product_card(product: Product) -> ProductCardOut:
    return ProductCardOut(id=product.id, name=product.name, slug=product.slug, short_description=product.short_description, category=product.category.name, price=product.price, compare_at_price=product.compare_at_price, currency=product.currency, status=product.status.value, is_featured=product.is_featured, is_new=product.is_new, collections=[collection.slug for collection in product.collections], media=[MediaOut.model_validate(media) for media in sorted(product.media, key=lambda item: item.sort_order)])


def product_detail(product: Product) -> dict:
    base = product_card(product).model_dump()
    return {
        **base,
        "description": product.description,
        "category_id": product.category_id,
        "collection_ids": [collection.id for collection in product.collections],
        "variants": [
            {
                "id": variant.id,
                "sku": variant.sku,
                "size": str(variant.options.get("size", "")),
                "color": str(variant.options.get("color", "")),
                "stock_quantity": variant.stock_quantity,
                "is_active": variant.is_active,
            }
            for variant in product.variants
        ],
        "attributes": [AttributeOut(name=value.definition.name, slug=value.definition.slug, value=value.value).model_dump() for value in product.attributes],
    }


async def load_product(session: AsyncSession, product_id: UUID) -> Product:
    stmt = select(Product).options(selectinload(Product.category), selectinload(Product.collections), selectinload(Product.media), selectinload(Product.variants), selectinload(Product.story_blocks), selectinload(Product.attributes).selectinload(ProductAttributeValue.definition)).where(Product.id == product_id)
    product = (await session.scalars(stmt)).unique().one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Товар не найден")
    return product


async def validate_taxonomy(session: AsyncSession, payload: ProductIn) -> tuple[Category, list[Collection]]:
    category = await session.get(Category, payload.category_id)
    if category is None:
        raise HTTPException(status_code=422, detail="Указана несуществующая категория")
    collections = list((await session.scalars(select(Collection).where(Collection.id.in_(payload.collection_ids)))).all()) if payload.collection_ids else []
    if len(collections) != len(payload.collection_ids):
        raise HTTPException(status_code=422, detail="Указана несуществующая коллекция")
    return category, collections


def resolve_status(requested: str, variants: list[VariantIn]) -> ProductStatus:
    if requested == "draft":
        return ProductStatus.draft
    if requested == "hidden":
        return ProductStatus.hidden
    return ProductStatus.published if any(item.is_active and item.stock_quantity > 0 for item in variants) else ProductStatus.out_of_stock


def attribute_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).lower().strip()
    return re.sub(r"[^\w]+", "-", normalized, flags=re.UNICODE).strip("-")[:90] or "attribute"


async def get_or_create_definition(session: AsyncSession, category_id: UUID, attribute: AttributeIn) -> ProductAttributeDefinition:
    definition = await session.scalar(select(ProductAttributeDefinition).where(ProductAttributeDefinition.category_id == category_id, ProductAttributeDefinition.name == attribute.name.strip()))
    if definition is not None:
        return definition
    base_slug = attribute_slug(attribute.name)
    slug = base_slug
    suffix = 2
    while await session.scalar(select(ProductAttributeDefinition.id).where(ProductAttributeDefinition.category_id == category_id, ProductAttributeDefinition.slug == slug)):
        slug = f"{base_slug[:85]}-{suffix}"
        suffix += 1
    definition = ProductAttributeDefinition(category_id=category_id, name=attribute.name.strip(), slug=slug, type="text", is_filterable=False)
    session.add(definition)
    await session.flush()
    return definition


async def replace_product_details(session: AsyncSession, product: Product, payload: ProductIn, collections: list[Collection], actor_user_id: UUID | None = None) -> None:
    existing_variants = {item.id: item for item in list((await session.scalars(select(ProductVariant).where(ProductVariant.product_id == product.id))).all())}
    incoming_ids = {item.id for item in payload.variants if item.id}
    await session.execute(delete(ProductAttributeValue).where(ProductAttributeValue.product_id == product.id))
    await session.execute(delete(CollectionProduct).where(CollectionProduct.product_id == product.id))
    await session.flush()
    variants: list[ProductVariant] = []
    for item in payload.variants:
        sku = (item.sku or f"{product.slug}-{item.size}").strip().upper()
        duplicate = await session.scalar(select(ProductVariant.id).where(ProductVariant.sku == sku, ProductVariant.id != item.id))
        if duplicate is not None:
            raise HTTPException(status_code=422, detail=f"SKU {sku} уже используется")
        variant = existing_variants.get(item.id) if item.id else None
        if variant is None:
            variant = ProductVariant(product_id=product.id, sku=sku, options={"size": item.size.strip(), "color": (item.color or "").strip()}, stock_quantity=item.stock_quantity, is_active=item.is_active); session.add(variant)
            await session.flush()
            if item.stock_quantity:
                session.add(InventoryMovement(variant_id=variant.id, delta=item.stock_quantity, balance_after=item.stock_quantity, reason="initial", note="Initial stock for new variant", actor_admin_user_id=actor_user_id))
        else:
            # Existing stock changes only through the inventory endpoint, preserving
            # movement history and avoiding a stale product-editor save overwriting it.
            variant.sku, variant.options, variant.is_active = sku, {"size": item.size.strip(), "color": (item.color or "").strip()}, item.is_active
        variants.append(variant)
    for variant_id, variant in existing_variants.items():
        if variant_id not in incoming_ids: variant.is_active = False
    values: list[ProductAttributeValue] = []
    for item in payload.attributes:
        definition = await get_or_create_definition(session, product.category_id, item)
        values.append(ProductAttributeValue(product_id=product.id, definition_id=definition.id, value=item.value.strip()))
    session.add_all(values)
    session.add_all([CollectionProduct(collection_id=collection.id, product_id=product.id, sort_order=index) for index, collection in enumerate(collections)])


async def ensure_slug_available(session: AsyncSession, slug: str, product_id: UUID | None = None) -> None:
    stmt = select(Product.id).where(Product.slug == slug)
    if product_id is not None:
        stmt = stmt.where(Product.id != product_id)
    if await session.scalar(stmt) is not None:
        raise HTTPException(status_code=422, detail="Slug уже используется")


@router.post("/auth/login")
async def login(payload: AdminLoginIn, request: Request, session: AsyncSession = Session):
    if not settings.admin_session_secret:
        raise HTTPException(status_code=503, detail="Авторизация администратора не настроена")
    enforce_login_rate_limit(request)
    login_value = payload.login.strip().lower()
    user = await session.scalar(select(AdminUser).where(AdminUser.login == login_value))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    try:
        valid = bcrypt.checkpw(payload.password.encode(), user.password_hash.encode())
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    request.session.clear()
    request.session["admin_user_id"] = str(user.id)
    request.session["session_version"] = user.session_version
    user.last_login_at = datetime.now(timezone.utc)
    add_audit(session, user, "auth.login")
    await session.commit()
    clear_login_attempts(request)
    return {"authenticated": True, "login": user.login, "role": user.role.value, "permissions": [item.value for item in permissions_for(user.role)]}


@router.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"authenticated": False}


@router.get("/auth/me")
async def me(request: Request, session: AsyncSession = Session):
    try:
        current = await current_admin(request, session)
    except HTTPException:
        return {"authenticated": False}
    return {"authenticated": True, "login": current.user.login, "role": current.user.role.value, "permissions": [item.value for item in permissions_for(current.user.role)]}


def moderator_or_404(user: AdminUser) -> AdminUser:
    if user.role != AdminRole.MODERATOR:
        raise HTTPException(status_code=404, detail="Moderator не найден")
    return user


async def load_moderator(session: AsyncSession, user_id: UUID) -> AdminUser:
    user = await session.get(AdminUser, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return moderator_or_404(user)


def admin_user_out(user: AdminUser) -> dict:
    return {"id": str(user.id), "login": user.login, "role": user.role.value, "is_active": user.is_active, "created_at": user.created_at, "updated_at": user.updated_at, "last_login_at": user.last_login_at}


@router.get("/users", dependencies=[Depends(require_permission(Permission.users_manage))])
async def users(session: AsyncSession = Session):
    items = list((await session.scalars(select(AdminUser).order_by(AdminUser.created_at))).all())
    return [admin_user_out(item) for item in items]


@router.post("/users", status_code=201)
async def create_moderator(payload: ModeratorCreateIn, current: CurrentAdmin = Depends(require_permission(Permission.users_manage)), session: AsyncSession = Session):
    login_value = payload.login.strip().lower()
    if await session.scalar(select(AdminUser.id).where(AdminUser.login == login_value)):
        raise HTTPException(status_code=422, detail="Этот логин уже используется")
    user = AdminUser(login=login_value, password_hash=bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(), role=AdminRole.MODERATOR)
    session.add(user)
    await session.flush()
    add_audit(session, current.user, "users.moderator_created", user.id)
    await session.commit()
    await session.refresh(user)
    return admin_user_out(user)


@router.patch("/users/{user_id}")
async def update_moderator(user_id: UUID, payload: ModeratorUpdateIn, current: CurrentAdmin = Depends(require_permission(Permission.users_manage)), session: AsyncSession = Session):
    user = await load_moderator(session, user_id)
    if payload.login is not None:
        login_value = payload.login.strip().lower()
        duplicate = await session.scalar(select(AdminUser.id).where(AdminUser.login == login_value, AdminUser.id != user.id))
        if duplicate:
            raise HTTPException(status_code=422, detail="Этот логин уже используется")
        user.login = login_value
    if payload.is_active is not None:
        user.is_active = payload.is_active
        if not user.is_active:
            user.session_version += 1
    add_audit(session, current.user, "users.moderator_updated", user.id, {"is_active": user.is_active})
    await session.commit()
    await session.refresh(user)
    return admin_user_out(user)


@router.post("/users/{user_id}/reset-password")
async def reset_moderator_password(user_id: UUID, payload: PasswordResetIn, current: CurrentAdmin = Depends(require_permission(Permission.users_manage)), session: AsyncSession = Session):
    user = await load_moderator(session, user_id)
    user.password_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    user.session_version += 1
    add_audit(session, current.user, "users.moderator_password_reset", user.id)
    await session.commit()
    return {"ok": True}


@router.post("/users/{user_id}/revoke-sessions")
async def revoke_moderator_sessions(user_id: UUID, current: CurrentAdmin = Depends(require_permission(Permission.users_manage)), session: AsyncSession = Session):
    user = await load_moderator(session, user_id)
    user.session_version += 1
    add_audit(session, current.user, "users.moderator_sessions_revoked", user.id)
    await session.commit()
    return {"ok": True}


@router.get("/audit", dependencies=[Depends(require_permission(Permission.audit_read))])
async def audit_log(session: AsyncSession = Session, user_id: UUID | None = None):
    stmt = select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(200)
    if user_id is not None:
        stmt = stmt.where((AdminAuditLog.actor_user_id == user_id) | (AdminAuditLog.target_user_id == user_id))
    items = list((await session.scalars(stmt)).all())
    users_by_id = {item.id: item.login for item in list((await session.scalars(select(AdminUser))).all())}
    return [{"id": str(item.id), "action": item.action, "actor_login": users_by_id.get(item.actor_user_id), "target_login": users_by_id.get(item.target_user_id), "created_at": item.created_at, "metadata": item.metadata_json} for item in items]

@router.get("/settings", dependencies=[Depends(require_permission(Permission.settings_manage))])
async def get_settings(session: AsyncSession = Session):
    item = await session.get(StoreSettings, 1)
    return item.content if item else {}

@router.put("/settings")
async def save_settings(payload: dict, current: CurrentAdmin = Depends(require_permission(Permission.settings_manage)), session: AsyncSession = Session):
    item = await session.get(StoreSettings, 1) or StoreSettings(id=1)
    item.content, item.updated_by = payload, current.user.id; session.add(item); await session.commit(); return item.content


@router.get("/dashboard", dependencies=[Depends(require_permission(Permission.products_read))])
async def dashboard(session: AsyncSession = Session):
    products = list((await session.scalars(select(Product).options(selectinload(Product.category), selectinload(Product.collections), selectinload(Product.media), selectinload(Product.variants)).order_by(Product.created_at.desc()))).unique())
    return {"total": len(products), "published": sum(product.status == ProductStatus.published for product in products), "hidden": sum(product.status in (ProductStatus.hidden, ProductStatus.draft) for product in products), "sale": sum(product.compare_at_price is not None for product in products), "low_stock": sum(sum(variant.stock_quantity for variant in product.variants if variant.is_active) < 2 for product in products), "recent": [product_card(product).model_dump() for product in products[:6]]}


@router.get("/products", dependencies=[Depends(require_permission(Permission.products_read))])
async def admin_products(session: AsyncSession = Session, q: str | None = None, status_filter: str | None = None):
    stmt = select(Product).options(selectinload(Product.category), selectinload(Product.collections), selectinload(Product.media), selectinload(Product.variants)).order_by(Product.created_at.desc())
    if q:
        stmt = stmt.where(Product.name.ilike(f"%{q}%"))
    if status_filter:
        try:
            stmt = stmt.where(Product.status == ProductStatus(status_filter))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Неизвестный статус") from error
    products = list((await session.scalars(stmt)).unique())
    return [product_card(product).model_dump() for product in products]


@router.get("/products/{product_id}", dependencies=[Depends(require_permission(Permission.products_read))])
async def admin_product(product_id: UUID, session: AsyncSession = Session):
    return product_detail(await load_product(session, product_id))


@router.post("/products", status_code=201)
async def create_product(payload: ProductIn, current: CurrentAdmin = Depends(require_permission(Permission.products_write)), session: AsyncSession = Session):
    category, collections = await validate_taxonomy(session, payload)
    await ensure_slug_available(session, payload.slug)
    product = Product(name=payload.name.strip(), slug=payload.slug, short_description=payload.short_description.strip(), description=payload.description.strip(), category_id=category.id, price=payload.price, compare_at_price=payload.compare_at_price, status=resolve_status(payload.status, payload.variants), is_featured=payload.is_featured, is_new=payload.is_new)
    session.add(product)
    await session.flush()
    await replace_product_details(session, product, payload, collections, current.user.id)
    await session.commit()
    return product_detail(await load_product(session, product.id))


@router.put("/products/{product_id}")
async def update_product(product_id: UUID, payload: ProductIn, current: CurrentAdmin = Depends(require_permission(Permission.products_write)), session: AsyncSession = Session):
    product = await load_product(session, product_id)
    category, collections = await validate_taxonomy(session, payload)
    await ensure_slug_available(session, payload.slug, product.id)
    product.name, product.slug = payload.name.strip(), payload.slug
    product.short_description, product.description = payload.short_description.strip(), payload.description.strip()
    product.category_id, product.price, product.compare_at_price = category.id, payload.price, payload.compare_at_price
    product.status, product.is_featured, product.is_new = resolve_status(payload.status, payload.variants), payload.is_featured, payload.is_new
    await replace_product_details(session, product, payload, collections, current.user.id)
    await session.commit()
    return product_detail(await load_product(session, product.id))


@router.delete("/products/{product_id}", status_code=204, dependencies=[Depends(require_permission(Permission.products_write))])
async def remove_product(product_id: UUID, session: AsyncSession = Session):
    product = await load_product(session, product_id)
    media = list(product.media)
    await session.execute(delete(CollectionProduct).where(CollectionProduct.product_id == product.id))
    await session.delete(product)
    await session.commit()
    for item in media:
        path = Path(settings.media_root) / "products" / Path(item.url).name
        path.unlink(missing_ok=True)


async def store_upload(file: UploadFile, directory_name: str = "products") -> tuple[str, str]:
    limit = settings.max_video_upload_bytes if file.content_type in ALLOWED_VIDEOS else settings.max_upload_bytes
    content = await file.read(limit + 1)
    if not content or len(content) > limit:
        raise HTTPException(status_code=413, detail="Размер файла превышает допустимый")
    if file.content_type in ALLOWED_VIDEOS:
        if (file.content_type == "video/mp4" and b"ftyp" not in content[:64]) or (file.content_type == "video/webm" and not content.startswith(b"\x1a\x45\xdf\xa3")):
            raise HTTPException(status_code=415, detail="Видео MP4 или WebM повреждено либо имеет неверный формат")
        suffix, media_type = ALLOWED_VIDEOS[file.content_type], "video"
    else:
        try:
            image = Image.open(io.BytesIO(content))
            image_format = image.format
            image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError):
            raise HTTPException(status_code=415, detail="Допустимы JPEG, PNG, WebP, MP4 или WebM")
        if image_format not in ALLOWED_IMAGES or file.content_type != ALLOWED_IMAGES[image_format][1]:
            raise HTTPException(status_code=415, detail="MIME type или формат изображения недопустим")
        suffix, _ = ALLOWED_IMAGES[image_format]
        media_type = "image"
    filename = f"{uuid4().hex}{suffix}"
    directory = Path(settings.media_root) / directory_name
    directory.mkdir(parents=True, exist_ok=True)
    (directory / filename).write_bytes(content)
    return f"/media/{directory_name}/{filename}", media_type


@router.get("/media", dependencies=[Depends(require_permission(Permission.media_manage))])
async def list_media(session: AsyncSession = Session, q: str | None = None, media_type: str | None = None):
    stmt = select(MediaAsset).order_by(MediaAsset.created_at.desc())
    if q: stmt = stmt.where(MediaAsset.alt_text.ilike(f"%{q}%"))
    if media_type: stmt = stmt.where(MediaAsset.mime_type.like(f"{media_type}/%"))
    return [{"id":str(item.id),"url":item.url,"mime_type":item.mime_type,"width":item.width,"height":item.height,"size_bytes":item.size_bytes,"alt_text":item.alt_text,"created_at":item.created_at} for item in list((await session.scalars(stmt)).all())]

@router.post("/media")
async def upload_content_media(file: UploadFile = File(...), current: CurrentAdmin = Depends(require_permission(Permission.media_manage)), session: AsyncSession = Session):
    url, media_type = await store_upload(file, "content")
    width = height = None
    if media_type == "image":
        image = Image.open(Path(settings.media_root) / "content" / Path(url).name); width, height = image.size
    asset = MediaAsset(storage_key=url.removeprefix("/media/"), url=url, mime_type=file.content_type or "application/octet-stream", width=width, height=height, size_bytes=(Path(settings.media_root) / "content" / Path(url).name).stat().st_size, alt_text=Path(file.filename or "").stem or None, created_by=current.user.id)
    session.add(asset); await session.commit(); await session.refresh(asset)
    return {"id":str(asset.id),"url": url, "type": media_type, "width":width, "height":height}

@router.patch("/media/{asset_id}", dependencies=[Depends(require_permission(Permission.media_manage))])
async def update_media_asset(asset_id: UUID, payload: dict, session: AsyncSession = Session):
    asset = await session.get(MediaAsset, asset_id)
    if asset is None: raise HTTPException(status_code=404, detail="Медиа не найдено")
    if "alt_text" in payload: asset.alt_text = str(payload["alt_text"])[:240] or None
    await session.commit(); await session.refresh(asset)
    return {"id":str(asset.id),"url":asset.url,"alt_text":asset.alt_text}

@router.delete("/media/{asset_id}", status_code=204, dependencies=[Depends(require_permission(Permission.media_manage))])
async def delete_media_asset(asset_id: UUID, session: AsyncSession = Session):
    asset = await session.get(MediaAsset, asset_id)
    if asset is None: raise HTTPException(status_code=404, detail="Медиа не найдено")
    used = await session.scalar(select(ProductMedia.id).where(ProductMedia.url == asset.url)) or await session.scalar(select(HomepageSection.id).where(HomepageSection.content.cast(Text).contains(asset.url)))
    if used: raise HTTPException(status_code=409, detail="Медиа используется и не может быть удалено")
    path = Path(settings.media_root) / asset.storage_key
    await session.delete(asset); await session.commit(); path.unlink(missing_ok=True)


@router.post("/products/{product_id}/media", dependencies=[Depends(require_permission(Permission.media_manage))])
@router.post("/products/{product_id}/images", dependencies=[Depends(require_permission(Permission.media_manage))])
async def upload_media(product_id: UUID, file: UploadFile = File(...), session: AsyncSession = Session):
    product = await load_product(session, product_id)
    url, media_type = await store_upload(file)
    existing = list(product.media)
    media = ProductMedia(product_id=product.id, type=media_type, url=url, alt_text=product.name, sort_order=max((item.sort_order for item in existing), default=-1) + 1, is_primary=not existing)
    session.add(media)
    await session.commit()
    await session.refresh(media)
    return MediaOut.model_validate(media)


@router.patch("/products/{product_id}/media/{media_id}", dependencies=[Depends(require_permission(Permission.media_manage))])
@router.patch("/products/{product_id}/images/{media_id}", dependencies=[Depends(require_permission(Permission.media_manage))])
async def update_image(product_id: UUID, media_id: UUID, payload: MediaUpdateIn, session: AsyncSession = Session):
    media = await session.scalar(select(ProductMedia).where(ProductMedia.id == media_id, ProductMedia.product_id == product_id))
    if media is None:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    if payload.sort_order is not None:
        items = list((await session.scalars(select(ProductMedia).where(ProductMedia.product_id == product_id).order_by(ProductMedia.sort_order, ProductMedia.id))).all())
        items = [item for item in items if item.id != media.id]
        items.insert(min(payload.sort_order, len(items)), media)
        for index, item in enumerate(items):
            item.sort_order = index
    if payload.is_primary is True:
        await session.execute(ProductMedia.__table__.update().where(ProductMedia.product_id == product_id).values(is_primary=False))
        media.is_primary = True
    if payload.is_secondary is True:
        await session.execute(ProductMedia.__table__.update().where(ProductMedia.product_id == product_id).values(is_secondary=False))
        media.is_secondary = True
    if payload.variant_id is not None:
        variant = await session.scalar(select(ProductVariant.id).where(ProductVariant.id == payload.variant_id, ProductVariant.product_id == product_id))
        if variant is None:
            raise HTTPException(status_code=422, detail="Вариант не относится к этому товару")
        media.variant_id = payload.variant_id
    if payload.alt_text is not None:
        media.alt_text = payload.alt_text
    await session.commit()
    await session.refresh(media)
    return MediaOut.model_validate(media)


@router.delete("/products/{product_id}/media/{media_id}", status_code=204, dependencies=[Depends(require_permission(Permission.media_manage))])
@router.delete("/products/{product_id}/images/{media_id}", status_code=204, dependencies=[Depends(require_permission(Permission.media_manage))])
async def remove_image(product_id: UUID, media_id: UUID, session: AsyncSession = Session):
    media = await session.scalar(select(ProductMedia).where(ProductMedia.id == media_id, ProductMedia.product_id == product_id))
    if media is None:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    path = Path(settings.media_root) / ("products" if "/products/" in media.url else "content") / Path(media.url).name
    await session.delete(media)
    await session.commit()
    path.unlink(missing_ok=True)


@router.get("/products/{product_id}/inventory", dependencies=[Depends(require_permission(Permission.inventory_manage))])
async def inventory_history(product_id: UUID, session: AsyncSession = Session):
    await load_product(session, product_id)
    rows = list((await session.scalars(select(InventoryMovement).join(ProductVariant).where(ProductVariant.product_id == product_id).order_by(InventoryMovement.created_at.desc()))).all())
    users = {item.id: item.login for item in list((await session.scalars(select(AdminUser))).all())}
    return [{"id":str(row.id),"variant_id":str(row.variant_id),"delta":row.delta,"balance_after":row.balance_after,"reason":row.reason,"note":row.note,"actor":users.get(row.actor_admin_user_id, "Система"),"created_at":row.created_at} for row in rows]


@router.post("/variants/{variant_id}/inventory")
async def adjust_inventory(variant_id: UUID, payload: dict, current: CurrentAdmin = Depends(require_permission(Permission.inventory_manage)), session: AsyncSession = Session):
    variant = await session.get(ProductVariant, variant_id)
    if variant is None: raise HTTPException(status_code=404, detail="Вариант не найден")
    delta = int(payload.get("delta", 0)); reason = str(payload.get("reason", "manual_adjustment")); note = str(payload.get("note", ""))[:1000] or None
    if reason not in {"manual_adjustment","sale","return","correction","initial","other"}: raise HTTPException(status_code=422, detail="Неизвестная причина")
    if not delta: raise HTTPException(status_code=422, detail="Укажите изменение остатка")
    balance = variant.stock_quantity + delta
    if balance < 0: raise HTTPException(status_code=409, detail="Остаток не может быть отрицательным")
    variant.stock_quantity = balance
    session.add(InventoryMovement(variant_id=variant.id,delta=delta,balance_after=balance,reason=reason,note=note,actor_admin_user_id=current.user.id)); await session.commit()
    return {"variant_id":str(variant.id),"stock_quantity":balance}


def order_summary(order: Order) -> dict:
    return {"id": str(order.id), "public_number": order.public_number, "status": order.status.value, "customer_name": order.customer_name, "phone": order.phone, "total": order.total, "currency": order.currency, "created_at": order.created_at, "updated_at": order.updated_at}


@router.get("/orders", dependencies=[Depends(require_permission(Permission.orders_read))])
async def admin_orders(session: AsyncSession = Session, q: str | None = None, status_filter: str | None = None):
    stmt = select(Order).order_by(Order.created_at.desc())
    if q:
        stmt = stmt.where((Order.public_number.ilike(f"%{q}%")) | (Order.customer_name.ilike(f"%{q}%")) | (Order.phone.ilike(f"%{q}%")))
    if status_filter:
        try:
            stmt = stmt.where(Order.status == OrderStatus(status_filter))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Неизвестный статус заказа") from error
    return [order_summary(item) for item in list((await session.scalars(stmt)).all())]


async def load_order(session: AsyncSession, order_id: UUID) -> Order:
    stmt = select(Order).options(selectinload(Order.items), selectinload(Order.history)).where(Order.id == order_id)
    order = (await session.scalars(stmt)).unique().one_or_none()
    if order is None:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    return order


@router.get("/orders/{order_id}", dependencies=[Depends(require_permission(Permission.orders_read))])
async def admin_order(order_id: UUID, session: AsyncSession = Session):
    order = await load_order(session, order_id)
    users = {item.id: item.login for item in list((await session.scalars(select(AdminUser))).all())}
    return {**order_summary(order), "email": order.email, "whatsapp": order.whatsapp, "delivery_method": order.delivery_method, "delivery_address": order.delivery_address, "comment": order.comment, "internal_note": order.internal_note, "items": [{"id": str(item.id), "product_name": item.product_name, "variant_description": item.variant_description, "sku": item.sku, "quantity": item.quantity, "unit_price": item.unit_price, "total_price": item.total_price} for item in order.items], "history": [{"id": str(row.id), "status": row.status.value, "note": row.note, "actor": users.get(row.actor_admin_user_id, "Система"), "created_at": row.created_at} for row in sorted(order.history, key=lambda item: item.created_at)]}


@router.put("/orders/{order_id}")
async def update_order(order_id: UUID, payload: dict, current: CurrentAdmin = Depends(require_permission(Permission.orders_manage)), session: AsyncSession = Session):
    order = await load_order(session, order_id)
    note = str(payload.get("note", ""))[:2000] or None
    if "internal_note" in payload:
        order.internal_note = str(payload.get("internal_note") or "")[:4000] or None
    requested = payload.get("status")
    if requested is not None:
        try:
            next_status = OrderStatus(str(requested))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Неизвестный статус заказа") from error
        previous_status = order.status
        if previous_status == OrderStatus.CANCELLED and next_status != previous_status:
            raise HTTPException(status_code=409, detail="Отменённый заказ нельзя снова активировать")
        if previous_status != next_status:
            if next_status == OrderStatus.CANCELLED:
                # A second CANCELLED update never enters this branch, so stock returns exactly once.
                for item in sorted(order.items, key=lambda value: str(value.variant_id or "")):
                    if item.variant_id is None:
                        continue
                    variant = await session.scalar(select(ProductVariant).where(ProductVariant.id == item.variant_id).with_for_update())
                    if variant is not None:
                        variant.stock_quantity += item.quantity
                        session.add(InventoryMovement(variant_id=variant.id, delta=item.quantity, balance_after=variant.stock_quantity, reason="return", note=f"Cancelled order {order.public_number}", actor_admin_user_id=current.user.id))
            order.status = next_status
            session.add(OrderStatusHistory(order_id=order.id, status=next_status, note=note, actor_admin_user_id=current.user.id))
    await session.commit()
    return await admin_order(order_id, session)


async def list_taxonomy(model, session: AsyncSession):
    return list((await session.scalars(select(model).order_by(model.sort_order, model.name))).all())


async def save_taxonomy(model, payload: TaxonomyIn, session: AsyncSession, item_id: UUID | None = None):
    duplicate = select(model.id).where(model.slug == payload.slug)
    if item_id is not None:
        duplicate = duplicate.where(model.id != item_id)
    if await session.scalar(duplicate):
        raise HTTPException(status_code=422, detail="Slug уже используется")
    item = await session.get(model, item_id) if item_id else model()
    if item is None:
        raise HTTPException(status_code=404, detail="Сущность не найдена")
    item.name, item.slug, item.description, item.media_url = payload.name.strip(), payload.slug, payload.description, payload.media_url
    item.sort_order, item.is_active = payload.sort_order, payload.is_active
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@router.get("/categories", dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def admin_categories(session: AsyncSession = Session): return await list_taxonomy(Category, session)
@router.post("/categories", dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def create_category(payload: TaxonomyIn, session: AsyncSession = Session): return await save_taxonomy(Category, payload, session)
@router.put("/categories/{item_id}", dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def update_category(item_id: UUID, payload: TaxonomyIn, session: AsyncSession = Session): return await save_taxonomy(Category, payload, session, item_id)
@router.delete("/categories/{item_id}", status_code=204, dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def remove_category(item_id: UUID, session: AsyncSession = Session):
    if await session.scalar(select(func.count(Product.id)).where(Product.category_id == item_id)):
        raise HTTPException(status_code=409, detail="Категория связана с товарами; скройте её вместо удаления")
    if await session.scalar(select(func.count(Category.id)).where(Category.parent_id == item_id)):
        raise HTTPException(status_code=409, detail="У категории есть дочерние категории; сначала перенесите или скройте их")
    item = await session.get(Category, item_id)
    if item is None: raise HTTPException(status_code=404, detail="Категория не найдена")
    await session.delete(item); await session.commit()

@router.get("/collections", dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def admin_collections(session: AsyncSession = Session): return await list_taxonomy(Collection, session)
@router.post("/collections", dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def create_collection(payload: TaxonomyIn, session: AsyncSession = Session): return await save_taxonomy(Collection, payload, session)
@router.put("/collections/{item_id}", dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def update_collection(item_id: UUID, payload: TaxonomyIn, session: AsyncSession = Session): return await save_taxonomy(Collection, payload, session, item_id)
@router.delete("/collections/{item_id}", status_code=204, dependencies=[Depends(require_permission(Permission.catalog_manage))])
async def remove_collection(item_id: UUID, session: AsyncSession = Session):
    if await session.scalar(select(func.count(CollectionProduct.product_id)).where(CollectionProduct.collection_id == item_id)):
        raise HTTPException(status_code=409, detail="Коллекция связана с товарами; скройте её вместо удаления")
    item = await session.get(Collection, item_id)
    if item is None: raise HTTPException(status_code=404, detail="Коллекция не найдена")
    await session.delete(item); await session.commit()


@router.get("/homepage", response_model=list[HomepageSectionOut], dependencies=[Depends(require_permission(Permission.homepage_manage))])
async def admin_homepage(session: AsyncSession = Session):
    return list((await session.scalars(select(HomepageSection).order_by(HomepageSection.sort_order))).all())


@router.put("/homepage/{key}", response_model=HomepageSectionOut, dependencies=[Depends(require_permission(Permission.homepage_manage))])
async def save_homepage(key: str, payload: HomepageSectionIn, current: CurrentAdmin = Depends(require_permission(Permission.homepage_manage)), session: AsyncSession = Session):
    if key != payload.key:
        raise HTTPException(status_code=422, detail="Ключ блока не совпадает")
    section = await session.scalar(select(HomepageSection).where(HomepageSection.key == key))
    if section is None:
        section = HomepageSection(key=key)
        session.add(section)
    section.enabled, section.sort_order, section.status, section.content = payload.enabled, payload.sort_order, payload.status, payload.content
    if payload.status == "published": session.add(HomepageRevision(section_key=key, content=payload.content, enabled=payload.enabled, sort_order=payload.sort_order, status=payload.status, created_by=current.user.id))
    await session.commit()
    await session.refresh(section)
    return section


@router.get("/homepage/{key}/revisions", dependencies=[Depends(require_permission(Permission.homepage_manage))])
async def homepage_revisions(key: str, session: AsyncSession = Session):
    return [{"id":str(item.id),"content":item.content,"enabled":item.enabled,"sort_order":item.sort_order,"status":item.status,"created_at":item.created_at} for item in list((await session.scalars(select(HomepageRevision).where(HomepageRevision.section_key == key).order_by(HomepageRevision.created_at.desc()).limit(20))).all())]


@router.post("/homepage/{key}/rollback/{revision_id}", dependencies=[Depends(require_permission(Permission.homepage_manage))])
async def rollback_homepage(key: str, revision_id: UUID, current: CurrentAdmin = Depends(require_permission(Permission.homepage_manage)), session: AsyncSession = Session):
    revision = await session.get(HomepageRevision, revision_id); section = await session.scalar(select(HomepageSection).where(HomepageSection.key == key))
    if revision is None or revision.section_key != key or section is None: raise HTTPException(status_code=404, detail="Версия не найдена")
    section.content, section.enabled, section.sort_order, section.status = revision.content, revision.enabled, revision.sort_order, revision.status
    session.add(HomepageRevision(section_key=key,content=section.content,enabled=section.enabled,sort_order=section.sort_order,status=section.status,created_by=current.user.id)); await session.commit(); return section


@router.get("/discounts", dependencies=[Depends(require_permission(Permission.discounts_manage))])
async def admin_discounts(session: AsyncSession = Session):
    return list((await session.scalars(select(Discount).order_by(Discount.name))).all())


async def save_discount(payload: DiscountIn, session: AsyncSession, item_id: UUID | None = None):
    if payload.product_id and await session.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=422, detail="Товар не найден")
    if payload.category_id and await session.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=422, detail="Категория не найдена")
    item = await session.get(Discount, item_id) if item_id else Discount()
    if item is None:
        raise HTTPException(status_code=404, detail="Акция не найдена")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    session.add(item); await session.commit(); await session.refresh(item)
    return item


@router.post("/discounts", dependencies=[Depends(require_permission(Permission.discounts_manage))])
async def create_discount(payload: DiscountIn, session: AsyncSession = Session): return await save_discount(payload, session)
@router.put("/discounts/{item_id}", dependencies=[Depends(require_permission(Permission.discounts_manage))])
async def update_discount(item_id: UUID, payload: DiscountIn, session: AsyncSession = Session): return await save_discount(payload, session, item_id)
@router.delete("/discounts/{item_id}", status_code=204, dependencies=[Depends(require_permission(Permission.discounts_manage))])
async def remove_discount(item_id: UUID, session: AsyncSession = Session):
    item = await session.get(Discount, item_id)
    if item is None: raise HTTPException(status_code=404, detail="Акция не найдена")
    await session.delete(item); await session.commit()
