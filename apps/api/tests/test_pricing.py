from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.models import Discount, Product
from app.pricing import effective_price, is_active


def product() -> Product:
    return Product(id=uuid4(), name="Платье", slug="plate", short_description="Тест", description="Тест", category_id=uuid4(), price=10_000)


def test_discount_lifecycle_and_best_price_policy():
    item = product()
    now = datetime.now(timezone.utc)
    active = Discount(name="Активная", product_id=item.id, percent_off=20, enabled=True)
    future = Discount(name="Будущая", product_id=item.id, percent_off=60, starts_at=now + timedelta(days=1), enabled=True)
    expired = Discount(name="Завершена", product_id=item.id, percent_off=70, ends_at=now - timedelta(seconds=1), enabled=True)
    disabled = Discount(name="Выключена", product_id=item.id, percent_off=80, enabled=False)
    assert is_active(active, now)
    assert not is_active(future, now)
    assert not is_active(expired, now)
    assert not is_active(disabled, now)
    assert effective_price(item, [active, future, expired, disabled], now) == (8_000, "Активная")


def test_product_and_category_discounts_do_not_stack():
    item = product()
    product_offer = Discount(name="Товар", product_id=item.id, percent_off=10, enabled=True)
    category_offer = Discount(name="Категория", category_id=item.category_id, fixed_price=7_500, enabled=True)
    assert effective_price(item, [product_offer, category_offer]) == (7_500, "Категория")
