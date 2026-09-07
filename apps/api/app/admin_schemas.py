from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class AdminLoginIn(BaseModel):
    login: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=256)


class ModeratorCreateIn(BaseModel):
    login: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=256)


class ModeratorUpdateIn(BaseModel):
    login: str | None = Field(default=None, min_length=3, max_length=120)
    is_active: bool | None = None


class PasswordResetIn(BaseModel):
    password: str = Field(min_length=8, max_length=256)


class VariantIn(BaseModel):
    id: UUID | None = None
    sku: str | None = Field(default=None, max_length=80)
    size: str = Field(min_length=1, max_length=40)
    color: str | None = Field(default=None, max_length=60)
    stock_quantity: int = Field(ge=0, le=100000)
    is_active: bool = True


class AttributeIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=240)


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    slug: str = Field(min_length=2, max_length=180, pattern=r"^[a-z0-9][a-z0-9-]*$")
    short_description: str = Field(min_length=2, max_length=300)
    description: str = Field(min_length=2)
    category_id: UUID
    collection_ids: list[UUID] = Field(default_factory=list)
    price: int = Field(gt=0)
    compare_at_price: int | None = Field(default=None, gt=0)
    status: Literal["draft", "published", "hidden"] = "draft"
    is_featured: bool = False
    is_new: bool = False
    variants: list[VariantIn] = Field(default_factory=list, max_length=60)
    attributes: list[AttributeIn] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def validate_prices_and_variants(self):
        if self.compare_at_price is not None and self.compare_at_price <= self.price:
            raise ValueError("Старая цена должна быть больше текущей")
        sizes = [variant.size.strip().lower() for variant in self.variants]
        if len(sizes) != len(set(sizes)):
            raise ValueError("Размеры вариантов не должны повторяться")
        if len(self.collection_ids) != len(set(self.collection_ids)):
            raise ValueError("Коллекции не должны повторяться")
        return self


class TaxonomyIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$")
    description: str | None = None
    media_url: str | None = Field(default=None, max_length=500)
    sort_order: int = Field(default=0, ge=0, le=10000)
    is_active: bool = True


class MediaUpdateIn(BaseModel):
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_primary: bool | None = None
    is_secondary: bool | None = None
    variant_id: UUID | None = None
    alt_text: str | None = Field(default=None, max_length=240)


class HomepageSectionIn(BaseModel):
    key: Literal["hero", "categories", "new", "cinematic", "featured", "promo", "benefits"]
    enabled: bool = True
    sort_order: int = Field(default=0, ge=0, le=1000)
    status: Literal["draft", "published"] = "published"
    content: dict[str, Any] = Field(default_factory=dict)


class DiscountIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    product_id: UUID | None = None
    category_id: UUID | None = None
    percent_off: int | None = Field(default=None, ge=1, le=99)
    fixed_price: int | None = Field(default=None, gt=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    enabled: bool = True
    show_on_homepage: bool = False
    media_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_discount(self):
        if (self.percent_off is None) == (self.fixed_price is None):
            raise ValueError("Укажите ровно один способ скидки")
        if self.product_id is not None and self.category_id is not None:
            raise ValueError("Акция может быть привязана к товару или категории")
        if self.ends_at and self.starts_at and self.ends_at <= self.starts_at:
            raise ValueError("Дата завершения должна быть позже даты начала")
        return self
