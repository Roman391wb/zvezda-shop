import enum
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class ProductStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    hidden = "hidden"
    out_of_stock = "out_of_stock"


class OrderStatus(str, enum.Enum):
    NEW = "NEW"
    CONFIRMED = "CONFIRMED"
    PROCESSING = "PROCESSING"
    READY = "READY"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class AdminRole(str, enum.Enum):
    ADMIN = "ADMIN"
    MODERATOR = "MODERATOR"


class AdminUser(Base):
    __tablename__ = "admin_users"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    login: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[AdminRole] = mapped_column(Enum(AdminRole), default=AdminRole.ADMIN)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AdminBootstrapState(Base):
    __tablename__ = "admin_bootstrap_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    actor_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True, index=True)
    target_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(160))
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    parent_id: Mapped[UUID | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    seo_title: Mapped[str | None] = mapped_column(String(180), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(Base):
    __tablename__ = "products"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(180))
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    short_description: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    category_id: Mapped[UUID] = mapped_column(ForeignKey("categories.id"))
    price: Mapped[int] = mapped_column(Integer)
    compare_at_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    status: Mapped[ProductStatus] = mapped_column(Enum(ProductStatus), default=ProductStatus.draft)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    is_new: Mapped[bool] = mapped_column(Boolean, default=False)
    seo_title: Mapped[str | None] = mapped_column(String(180), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(320), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(80), nullable=True)
    weight_grams: Mapped[int | None] = mapped_column(Integer, nullable=True)
    supplier: Mapped[str | None] = mapped_column(String(180), nullable=True)
    cost_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    category: Mapped[Category] = relationship(back_populates="products")
    media: Mapped[list["ProductMedia"]] = relationship(cascade="all, delete-orphan")
    variants: Mapped[list["ProductVariant"]] = relationship(cascade="all, delete-orphan")
    attributes: Mapped[list["ProductAttributeValue"]] = relationship(cascade="all, delete-orphan")
    story_blocks: Mapped[list["ProductStoryBlock"]] = relationship(cascade="all, delete-orphan")
    collections: Mapped[list["Collection"]] = relationship(secondary="collection_products", back_populates="products")


class ProductMedia(Base):
    __tablename__ = "product_media"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    variant_id: Mapped[UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String(20), default="image")
    url: Mapped[str] = mapped_column(String(500))
    alt_text: Mapped[str] = mapped_column(String(240))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    is_secondary: Mapped[bool] = mapped_column(Boolean, default=False)


class ProductVariant(Base):
    __tablename__ = "product_variants"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    sku: Mapped[str] = mapped_column(String(80), unique=True)
    options: Mapped[dict[str, Any]] = mapped_column(JSON)
    stock_quantity: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    media: Mapped[list["ProductMedia"]] = relationship()


class ProductAttributeDefinition(Base):
    __tablename__ = "attribute_definitions"
    __table_args__ = (UniqueConstraint("category_id", "slug"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    category_id: Mapped[UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(30))
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_filterable: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ProductAttributeValue(Base):
    __tablename__ = "attribute_values"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    definition_id: Mapped[UUID] = mapped_column(ForeignKey("attribute_definitions.id"))
    value: Mapped[str] = mapped_column(String(240))
    definition: Mapped[ProductAttributeDefinition] = relationship()


class Collection(Base):
    __tablename__ = "collections"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    seo_title: Mapped[str | None] = mapped_column(String(180), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(320), nullable=True)
    products: Mapped[list["Product"]] = relationship(secondary="collection_products", back_populates="collections")


class CollectionProduct(Base):
    __tablename__ = "collection_products"
    collection_id: Mapped[UUID] = mapped_column(ForeignKey("collections.id"), primary_key=True)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ProductStoryBlock(Base):
    __tablename__ = "product_story_blocks"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str | None] = mapped_column(String(180), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)


class HomepageSection(Base):
    __tablename__ = "homepage_sections"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    key: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="published")
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class HomepageRevision(Base):
    __tablename__ = "homepage_revisions"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    section_key: Mapped[str] = mapped_column(String(50), index=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="published")
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Discount(Base):
    __tablename__ = "discounts"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(160))
    product_id: Mapped[UUID | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    category_id: Mapped[UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), nullable=True)
    percent_off: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fixed_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    show_on_homepage: Mapped[bool] = mapped_column(Boolean, default=False)
    media_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    url: Mapped[str] = mapped_column(String(500), unique=True)
    mime_type: Mapped[str] = mapped_column(String(100))
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    alt_text: Mapped[str | None] = mapped_column(String(240), nullable=True)
    usage_metadata: Mapped[dict[str, Any] | None] = mapped_column("usage_metadata", JSON, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    variant_id: Mapped[UUID] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_admin_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class StoreSettings(Base):
    __tablename__ = "store_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_by: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    public_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.NEW)
    customer_name: Mapped[str] = mapped_column(String(180))
    phone: Mapped[str] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(180), nullable=True)
    whatsapp: Mapped[str | None] = mapped_column(String(60), nullable=True)
    delivery_method: Mapped[str] = mapped_column(String(80), default="whatsapp")
    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    subtotal: Mapped[int] = mapped_column(Integer)
    discount_total: Mapped[int] = mapped_column(Integer, default=0)
    delivery_total: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan")
    history: Mapped[list["OrderStatusHistory"]] = relationship(cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[UUID | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    variant_id: Mapped[UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="SET NULL"), nullable=True)
    product_name: Mapped[str] = mapped_column(String(180))
    variant_description: Mapped[str] = mapped_column(String(240))
    sku: Mapped[str] = mapped_column(String(80))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[int] = mapped_column(Integer)
    total_price: Mapped[int] = mapped_column(Integer)


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_admin_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
