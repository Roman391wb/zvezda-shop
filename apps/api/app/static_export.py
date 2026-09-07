"""One-shot exporter for the public static storefront dataset.

Run this against the existing full-stack database before a static deployment.
It is read-only: no products, media, inventory or CMS records are changed.
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .db import SessionLocal
from .models import Category, Collection, HomepageSection, Product, ProductVariant, StoreSettings


def media(item):
    return {
        "id": str(item.id), "type": item.type, "url": item.url,
        "alt_text": item.alt_text, "sort_order": item.sort_order,
        "is_primary": item.is_primary, "is_secondary": item.is_secondary,
        "variant_id": str(item.variant_id) if item.variant_id else None,
    }


async def export(destination: Path) -> None:
    async with SessionLocal() as session:
        products = list((await session.scalars(select(Product).options(
            selectinload(Product.category), selectinload(Product.collections),
            selectinload(Product.media), selectinload(Product.variants).selectinload(ProductVariant.media),
        ).order_by(Product.created_at))).unique())
        categories = list((await session.scalars(select(Category).where(Category.is_active).order_by(Category.sort_order))).all())
        collections = list((await session.scalars(select(Collection).where(Collection.is_active).order_by(Collection.sort_order))).all())
        homepage = list((await session.scalars(select(HomepageSection).where(HomepageSection.enabled, HomepageSection.status == "published").order_by(HomepageSection.sort_order))).all())
        settings = await session.get(StoreSettings, 1)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "products": [{
            "id": str(product.id), "name": product.name, "slug": product.slug,
            "short_description": product.short_description, "description": product.description,
            "category": product.category.name, "category_slug": product.category.slug,
            "price": product.price, "compare_at_price": product.compare_at_price,
            "currency": product.currency, "status": product.status.value,
            "is_featured": product.is_featured, "is_new": product.is_new,
            "collections": [collection.slug for collection in product.collections],
            "media": [media(item) for item in sorted(product.media, key=lambda value: value.sort_order)],
            "variants": [{
                "id": str(item.id), "sku": item.sku, "options": item.options,
                "stock_quantity": item.stock_quantity, "is_active": item.is_active,
                "media": [media(asset) for asset in sorted(item.media, key=lambda value: value.sort_order)],
            } for item in product.variants],
        } for product in products],
        "categories": [{"name": item.name, "slug": item.slug, "description": item.description, "media_url": item.media_url} for item in categories],
        "collections": [{"name": item.name, "slug": item.slug, "description": item.description, "media_url": item.media_url} for item in collections],
        "homepage": [{"key": item.key, "enabled": item.enabled, "sort_order": item.sort_order, "status": item.status, "content": item.content} for item in homepage],
        "settings": settings.content if settings else {},
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"exported products={len(products)} categories={len(categories)} collections={len(collections)} homepage={len(homepage)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m app.static_export /path/to/storefront.json")
    asyncio.run(export(Path(sys.argv[1])))
