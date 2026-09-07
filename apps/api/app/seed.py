from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Category, Collection, CollectionProduct, Product, ProductAttributeDefinition,
    ProductAttributeValue, ProductMedia, ProductStatus, ProductStoryBlock, ProductVariant,
)

MEDIA = [
    "/images/dress-studio.jpg",
    "/images/dress-editorial.jpg",
    "/images/dress-store.jpg",
    "/images/dress-blueprint.jpg",
    "/images/dress-details.jpg",
]


async def seed_database(session: AsyncSession) -> None:
    if await session.scalar(select(Product.id).limit(1)):
        return
    women = await session.scalar(select(Category).where(Category.slug == "zhenskoe"))
    if women is None:
        women = Category(name="Женское", slug="zhenskoe", description="Одежда для выразительных и тихих моментов", sort_order=1)
        session.add(women)
        await session.flush()
    categories = [women]
    for name, slug, order in (("Мужское", "muzhskoe", 2), ("Аксессуары", "aksessuary", 3)):
        if await session.scalar(select(Category.id).where(Category.slug == slug)) is None:
            session.add(Category(name=name, slug=slug, description="Будущая категория магазина", sort_order=order, is_active=False))
    material = ProductAttributeDefinition(category_id=categories[0].id, name="Материал", slug="material", type="text", is_filterable=True)
    length = ProductAttributeDefinition(category_id=categories[0].id, name="Длина", slug="length", type="text", is_filterable=True)
    season = ProductAttributeDefinition(category_id=categories[0].id, name="Сезон", slug="season", type="text", is_filterable=True)
    session.add_all([material, length, season])
    await session.flush()
    specs = [
        ("Платье Нур", "plate-nur", "Воздушный многоярусный силуэт с деликатной отделкой", 1899000, None, True),
        ("Платье Сафия", "plate-safiya", "Мягкая линия плеча и выразительные кружевные манжеты", 1599000, 1899000, True),
        ("Платье Амаль", "plate-amal", "Лаконичный образ с тонкой вышивкой по линии талии", 1399000, None, False),
        ("Платье Лейла", "plate-leyla", "Текучая ткань и спокойный архитектурный объём", 1699000, None, True),
        ("Костюм Самир", "kostyum-samir", "Свободный жакет и широкие брюки", 2199000, None, False),
        ("Платок Дымка", "platok-dymka", "Полупрозрачный шёлковый платок", 399000, 499000, False),
        ("Пальто Тишина", "palto-tishina", "Чистый силуэт из мягкой шерсти", 2799000, None, False),
        ("Платье Рания", "plate-raniya", "Сдержанное платье для длинных вечеров", 1499000, None, False),
    ]
    products: list[Product] = []
    for i, (name, slug, short, price, old_price, featured) in enumerate(specs):
        category = categories[0]
        product = Product(name=name, slug=slug, short_description=short, description="Продуманный силуэт, созданный для свободы движения. Тактильная матовая ткань мягко ложится по фигуре и сохраняет форму в течение дня.", category_id=category.id, price=price, compare_at_price=old_price, status=ProductStatus.published, is_featured=featured, is_new=i < 4)
        session.add(product)
        await session.flush()
        session.add_all([ProductMedia(product_id=product.id, url=MEDIA[(i + j) % len(MEDIA)], alt_text=f"{name}, вид {j + 1}", sort_order=j, is_primary=j == 0) for j in range(4)])
        session.add_all([ProductVariant(product_id=product.id, sku=f"{slug.upper()}-{size}", options={"size": size, "color": "Чёрный"}, stock_quantity=4 if size != "48" else 0) for size in ("42", "44", "46", "48")])
        if category == categories[0]:
            session.add_all([
                ProductAttributeValue(product_id=product.id, definition_id=material.id, value="Вискоза 72%, полиэстер 28%"),
                ProductAttributeValue(product_id=product.id, definition_id=length.id, value="Макси"),
                ProductAttributeValue(product_id=product.id, definition_id=season.id, value="Всесезонный"),
            ])
            session.add_all([
                ProductStoryBlock(product_id=product.id, type="detail", title="Детали, которые остаются", body="Обтяжные пуговицы и бисерная линия собираются вручную. Воротник сохраняет мягкость, не теряя формы.", media_url=MEDIA[4], sort_order=1),
                ProductStoryBlock(product_id=product.id, type="fabric", title="Ткань в движении", body="Матовая, прохладная к телу ткань образует глубокие мягкие складки и не просвечивает.", media_url=MEDIA[0], sort_order=2),
                ProductStoryBlock(product_id=product.id, type="gallery", title="Силуэт и посадка", body="Свободный крой, регулируемая линия талии и длина до щиколотки.", media_url=MEDIA[1], sort_order=3),
            ])
        products.append(product)
    collections = [Collection(name=name, slug=slug, sort_order=i) for i, (name, slug) in enumerate((("Новинки", "novinki"), ("Популярное", "populyarnoe"), ("Распродажа", "rasprodazha")))]
    session.add_all(collections)
    await session.flush()
    session.add_all([CollectionProduct(collection_id=collections[0].id, product_id=p.id, sort_order=i) for i, p in enumerate(products[:4])])
    session.add_all([CollectionProduct(collection_id=collections[1].id, product_id=p.id, sort_order=i) for i, p in enumerate(products) if p.is_featured])
    session.add_all([CollectionProduct(collection_id=collections[2].id, product_id=p.id, sort_order=i) for i, p in enumerate(products) if p.compare_at_price])
    await session.commit()
