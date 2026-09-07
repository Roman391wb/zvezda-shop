from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    type: str
    url: str
    alt_text: str
    sort_order: int
    is_primary: bool
    is_secondary: bool = False
    variant_id: UUID | None = None


class VariantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    sku: str
    options: dict[str, Any]
    stock_quantity: int
    is_active: bool
    media: list[MediaOut] = []


class AttributeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    slug: str
    value: str


class StoryBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    type: str
    title: str | None
    body: str | None
    media_url: str | None
    sort_order: int
    metadata: dict[str, Any] | None = None


class ProductCardOut(BaseModel):
    id: UUID
    name: str
    slug: str
    short_description: str
    category: str
    price: int
    compare_at_price: int | None
    currency: str
    status: str
    is_featured: bool
    is_new: bool
    collections: list[str]
    media: list[MediaOut]
    effective_price: int | None = None
    discount_name: str | None = None


class ProductOut(ProductCardOut):
    description: str
    variants: list[VariantOut]
    attributes: list[AttributeOut]
    story_blocks: list[StoryBlockOut]


class ProductListOut(BaseModel):
    items: list[ProductCardOut]
    total: int
    limit: int
    offset: int


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    slug: str
    description: str | None
    media_url: str | None


class CollectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    slug: str
    description: str | None
    media_url: str | None


class HomepageSectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    enabled: bool
    sort_order: int
    status: str
    content: dict[str, Any]


class CheckoutLineIn(BaseModel):
    product_id: UUID
    variant_id: UUID
    quantity: int


class CheckoutIn(BaseModel):
    lines: list[CheckoutLineIn]


class OrderCreateIn(CheckoutIn):
    customer_name: str = Field(min_length=1, max_length=180)
    phone: str = Field(min_length=3, max_length=60)
    email: str | None = None
    whatsapp: str | None = None
    delivery_method: str = "whatsapp"
    delivery_address: str | None = None
    comment: str | None = None


class CheckoutLineOut(BaseModel):
    name: str
    slug: str
    options: dict[str, Any]
    quantity: int
    unit_price: int
    subtotal: int


class CheckoutOut(BaseModel):
    lines: list[CheckoutLineOut]
    total: int
