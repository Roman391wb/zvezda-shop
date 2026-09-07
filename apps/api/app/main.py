from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .db import SessionLocal, engine, get_session
from .config import settings
from .models import AdminBootstrapState, AdminRole, AdminUser, Category, Collection, Discount, HomepageSection, InventoryMovement, Order, OrderItem, OrderStatus, OrderStatusHistory, Product, ProductAttributeValue, ProductStatus, ProductVariant, StoreSettings
from .pricing import effective_price
from .schemas import AttributeOut, CategoryOut, CheckoutIn, CheckoutLineOut, CheckoutOut, CollectionOut, HomepageSectionOut, MediaOut, OrderCreateIn, ProductCardOut, ProductListOut, ProductOut, StoryBlockOut, VariantOut
from .seed import seed_database
from .admin import router as admin_router

Session = Annotated[AsyncSession, Depends(get_session)]
HOMEPAGE_DEFAULTS = [
    ("hero", 0, {"eyebrow": "Новая глава", "title": "Коллекция ждёт своего образа", "subtitle": "Выберите силуэт, который говорит за вас.", "cta_label": "Смотреть коллекцию", "cta_href": "/catalog"}),
    ("categories", 1, {"eyebrow": "Выбор", "title": "Категории"}),
    ("new", 2, {"eyebrow": "Свежий взгляд", "title": "Новинки", "cta_label": "Все новинки", "cta_href": "/catalog?sort=newest"}),
    ("featured", 3, {"eyebrow": "Избранное", "title": "Хиты", "cta_label": "Смотреть каталог", "cta_href": "/catalog"}),
    ("promo", 4, {"eyebrow": "Для вас", "title": "Ваш следующий образ начинается здесь"}),
    ("benefits", 5, {"items": [{"title": "Доставка", "text": ""}, {"title": "Возврат", "text": ""}, {"title": "Оплата", "text": ""}, {"title": "Поддержка", "text": ""}]}),
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.seed_demo_data:
        async with SessionLocal() as session:
            await seed_database(session)
    async with SessionLocal() as session:
        bootstrap_done = await session.get(AdminBootstrapState, 1)
        if bootstrap_done is None and settings.admin_bootstrap_login and settings.admin_password_hash:
            login = settings.admin_bootstrap_login.strip().lower()
            if login:
                session.add(AdminUser(login=login, password_hash=settings.admin_password_hash, role=AdminRole.ADMIN))
                session.add(AdminBootstrapState(id=1))
                await session.commit()
    async with SessionLocal() as session:
        existing = {item.key for item in list((await session.scalars(select(HomepageSection))).all())}
        missing = [HomepageSection(key=key, sort_order=order, status="published", enabled=True, content=content) for key, order, content in HOMEPAGE_DEFAULTS if key not in existing]
        if missing:
            session.add_all(missing)
            await session.commit()
    yield
    # Releases asyncpg connections on shutdown.  Besides graceful container
    # shutdown this keeps separate TestClient event loops from reusing a pool
    # connection attached to an earlier loop.
    await engine.dispose()


app = FastAPI(title="Зиярат API", version="0.1.0", lifespan=lifespan)
if not settings.admin_session_secret:
    raise RuntimeError("ADMIN_SESSION_SECRET is required")
app.add_middleware(SessionMiddleware, secret_key=settings.admin_session_secret, session_cookie="ziyarat_admin_session", max_age=60 * 60 * 12, same_site="lax", https_only=settings.admin_cookie_secure, path="/")
Path(settings.media_root).mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.media_root), name="media")
app.include_router(admin_router)


@app.middleware("http")
async def security_headers_and_csrf(request: Request, call_next):
    # Browser mutations must originate from the one configured storefront.  API
    # service-to-service calls are internal; production has no public API port.
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/") and settings.app_env == "production":
        origin = request.headers.get("origin")
        if origin != settings.public_origin:
            return JSONResponse(status_code=403, content={"detail": "Недопустимый источник запроса"})
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith("/admin") or request.url.path.startswith("/api/admin"):
        response.headers.setdefault("X-Robots-Tag", "noindex, nofollow, noarchive")
    return response


def card(product: Product, discounts: list[Discount] | None = None) -> ProductCardOut:
    price, discount_name = effective_price(product, discounts or [])
    compare_at = product.compare_at_price or (product.price if discount_name else None)
    return ProductCardOut(id=product.id, name=product.name, slug=product.slug, short_description=product.short_description, category=product.category.name, price=price, compare_at_price=compare_at, currency=product.currency, status=product.status.value, is_featured=product.is_featured, is_new=product.is_new, collections=[collection.slug for collection in product.collections], media=[MediaOut.model_validate(m) for m in sorted(product.media, key=lambda m: m.sort_order)], effective_price=price, discount_name=discount_name)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/categories", response_model=list[CategoryOut])
async def categories(session: Session):
    items = list((await session.scalars(select(Category).where(Category.is_active, Category.parent_id.is_(None)).order_by(Category.sort_order))).all())
    return items


@app.get("/api/collections", response_model=list[CollectionOut])
async def collections(session: Session):
    return (await session.scalars(select(Collection).where(Collection.is_active).order_by(Collection.sort_order))).all()


@app.get("/api/homepage", response_model=list[HomepageSectionOut])
async def homepage(session: Session):
    return list((await session.scalars(select(HomepageSection).where(HomepageSection.enabled, HomepageSection.status == "published").order_by(HomepageSection.sort_order))).all())


@app.get("/api/settings")
async def public_settings(session: Session):
    item = await session.get(StoreSettings, 1)
    return item.content if item else {}


@app.get("/api/products", response_model=ProductListOut)
async def products(session: Session, q: str | None = None, category: str | None = None, collection: str | None = None, sort: str = "recommended", min_price: int | None = None, max_price: int | None = None, size: str | None = None, color: str | None = None, in_stock: bool = False, featured: bool = False, is_new: bool = False, sale: bool = False, limit: Annotated[int, Query(ge=1, le=48)] = 12, offset: Annotated[int, Query(ge=0)] = 0):
    stmt = select(Product).options(selectinload(Product.media), selectinload(Product.category), selectinload(Product.collections), selectinload(Product.variants).selectinload(ProductVariant.media)).where(Product.status.in_([ProductStatus.published, ProductStatus.out_of_stock]))
    if q:
        stmt = stmt.outerjoin(Product.category).outerjoin(Product.collections).where(or_(Product.name.ilike(f"%{q}%"), Product.short_description.ilike(f"%{q}%"), Category.name.ilike(f"%{q}%"), Collection.name.ilike(f"%{q}%")))
    if category:
        if category == "sale":
            pass
        else:
            parent_id = select(Category.id).where(Category.slug == category).scalar_subquery()
            stmt = stmt.join(Product.category).where(or_(Category.slug == category, Category.parent_id == parent_id))
    if collection:
        stmt = stmt.join(Product.collections).where(Collection.slug == collection)
    if in_stock: stmt = stmt.where(Product.status == ProductStatus.published)
    if featured: stmt = stmt.where(Product.is_featured)
    if is_new: stmt = stmt.where(Product.is_new)
    ordering = {"newest": (Product.created_at.desc(),), "price-asc": (Product.price.asc(),), "price-desc": (Product.price.desc(),)}.get(sort, (Product.is_featured.desc(), Product.is_new.desc()))
    stmt = stmt.order_by(*ordering)
    all_items = list((await session.scalars(stmt)).unique())
    if size:
        all_items = [item for item in all_items if any(str(variant.options.get("size", "")).lower() == size.lower() for variant in item.variants)]
    if color:
        all_items = [item for item in all_items if any(str(variant.options.get("color", "")).lower() == color.lower() for variant in item.variants)]
    discounts = list((await session.scalars(select(Discount))).all())
    rendered = [card(product, discounts) for product in all_items]
    if sale:
        rendered = [item for item in rendered if item.compare_at_price is not None]
    if min_price is not None: rendered = [item for item in rendered if item.price >= min_price]
    if max_price is not None: rendered = [item for item in rendered if item.price <= max_price]
    if sort == "price-asc": rendered.sort(key=lambda item: item.price)
    if sort == "price-desc": rendered.sort(key=lambda item: item.price, reverse=True)
    return ProductListOut(items=rendered[offset:offset + limit], total=len(rendered), limit=limit, offset=offset)


@app.get("/api/products/{slug}", response_model=ProductOut)
async def product_detail(slug: str, session: Session):
    stmt = select(Product).options(selectinload(Product.category), selectinload(Product.collections), selectinload(Product.media), selectinload(Product.variants).selectinload(ProductVariant.media), selectinload(Product.story_blocks), selectinload(Product.attributes).selectinload(ProductAttributeValue.definition)).where(Product.slug == slug, Product.status.in_([ProductStatus.published, ProductStatus.out_of_stock]))
    product = (await session.scalars(stmt)).unique().one_or_none()
    if product is None: raise HTTPException(status_code=404, detail="Product not found")
    discounts = list((await session.scalars(select(Discount))).all())
    base = card(product, discounts).model_dump()
    return ProductOut(**base, description=product.description, variants=[VariantOut.model_validate(v) for v in product.variants], attributes=[AttributeOut(name=a.definition.name, slug=a.definition.slug, value=a.value) for a in product.attributes], story_blocks=[StoryBlockOut(type=b.type, title=b.title, body=b.body, media_url=b.media_url, sort_order=b.sort_order, metadata=b.metadata_json) for b in sorted(product.story_blocks, key=lambda b: b.sort_order)])


@app.post("/api/checkout/quote", response_model=CheckoutOut)
async def checkout_quote(payload: CheckoutIn, session: Session):
    if not payload.lines:
        raise HTTPException(status_code=422, detail="Корзина пуста")
    product_ids = {line.product_id for line in payload.lines}
    items = list((await session.scalars(select(Product).options(selectinload(Product.category)).where(Product.id.in_(product_ids)))).all())
    products_by_id = {item.id: item for item in items}
    discounts = list((await session.scalars(select(Discount))).all())
    result: list[CheckoutLineOut] = []
    for line in payload.lines:
        product = products_by_id.get(line.product_id)
        if product is None or product.status != ProductStatus.published:
            raise HTTPException(status_code=409, detail="Один из товаров больше недоступен")
        variant = await session.scalar(select(ProductVariant).where(ProductVariant.id == line.variant_id, ProductVariant.product_id == product.id, ProductVariant.is_active))
        if variant is None or line.quantity < 1 or line.quantity > variant.stock_quantity:
            raise HTTPException(status_code=409, detail=f"Недостаточно товара «{product.name}»")
        price, _ = effective_price(product, discounts)
        result.append(CheckoutLineOut(name=product.name, slug=product.slug, options=variant.options, quantity=line.quantity, unit_price=price, subtotal=price * line.quantity))
    return CheckoutOut(lines=result, total=sum(line.subtotal for line in result))


@app.post("/api/checkout/orders")
async def create_order(payload: OrderCreateIn, session: Session):
    if not payload.lines:
        raise HTTPException(status_code=422, detail="Корзина пуста")
    # Re-read and lock every requested product/variant in this transaction.  The quote
    # endpoint is deliberately not trusted for a final purchase: price, publication
    # state and stock all have to be current when the order is written.
    product_ids = {line.product_id for line in payload.lines}
    products = list((await session.scalars(select(Product).where(Product.id.in_(product_ids)).order_by(Product.id).with_for_update())).all())
    products_by_id = {product.id: product for product in products}
    variant_ids = {line.variant_id for line in payload.lines}
    variants = list((await session.scalars(select(ProductVariant).where(ProductVariant.id.in_(variant_ids)).order_by(ProductVariant.id).with_for_update())).all())
    variants_by_id = {variant.id: variant for variant in variants}
    discounts = list((await session.scalars(select(Discount))).all())
    rendered: list[tuple[Product, ProductVariant, int, int]] = []
    reserved: dict[object, int] = {}
    for line in payload.lines:
        product, variant = products_by_id.get(line.product_id), variants_by_id.get(line.variant_id)
        if product is None or product.status != ProductStatus.published or variant is None or variant.product_id != product.id or not variant.is_active or line.quantity < 1:
            raise HTTPException(status_code=409, detail="Один из товаров больше недоступен")
        reserved[variant.id] = reserved.get(variant.id, 0) + line.quantity
        if reserved[variant.id] > variant.stock_quantity:
            raise HTTPException(status_code=409, detail=f"Недостаточно товара «{product.name}»")
        unit_price, _ = effective_price(product, discounts)
        rendered.append((product, variant, unit_price, unit_price * line.quantity))
    total = sum(item[3] for item in rendered)
    from uuid import uuid4
    order = Order(public_number=f"Z-{uuid4().hex[:8].upper()}",status=OrderStatus.NEW,customer_name=payload.customer_name.strip(),phone=payload.phone.strip(),email=payload.email,whatsapp=payload.whatsapp,delivery_method=payload.delivery_method,delivery_address=payload.delivery_address,comment=payload.comment,subtotal=total,total=total,currency="RUB")
    session.add(order); await session.flush()
    for line, (product, variant, unit_price, line_total) in zip(payload.lines, rendered):
        variant.stock_quantity -= line.quantity
        session.add(OrderItem(order_id=order.id,product_id=product.id,variant_id=variant.id,product_name=product.name,variant_description=" · ".join(str(v) for v in variant.options.values() if v),sku=variant.sku,quantity=line.quantity,unit_price=unit_price,total_price=line_total))
        session.add(InventoryMovement(variant_id=variant.id,delta=-line.quantity,balance_after=variant.stock_quantity,reason="sale",note=f"Order {order.public_number}"))
    session.add(OrderStatusHistory(order_id=order.id,status=OrderStatus.NEW)); await session.commit()
    return {"id":str(order.id),"public_number":order.public_number,"total":order.total,"currency":order.currency}
