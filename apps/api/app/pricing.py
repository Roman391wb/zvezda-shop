from datetime import datetime, timezone

from .models import Discount, Product


def is_active(discount: Discount, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    def normalise(value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value
    starts_at, ends_at = normalise(discount.starts_at), normalise(discount.ends_at)
    return discount.enabled and (starts_at is None or starts_at <= now) and (ends_at is None or now < ends_at)


def effective_price(product: Product, discounts: list[Discount], now: datetime | None = None) -> tuple[int, str | None]:
    """The single most beneficial active offer wins; discounts never stack."""
    candidates: list[tuple[int, str]] = []
    for discount in discounts:
        if not is_active(discount, now):
            continue
        if discount.product_id not in (None, product.id) or discount.category_id not in (None, product.category_id):
            continue
        price = discount.fixed_price if discount.fixed_price is not None else product.price * (100 - (discount.percent_off or 0)) // 100
        if 0 < price < product.price:
            candidates.append((price, discount.name))
    candidates.append((product.price, ""))
    price, name = min(candidates, key=lambda item: item[0])
    return price, name or None
