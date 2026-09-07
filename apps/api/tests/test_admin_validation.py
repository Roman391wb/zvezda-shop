from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.admin_schemas import ProductIn
from app.main import app


def payload(**changes):
    result = {
        "name": "Платье Алия",
        "slug": "plate-aliya",
        "short_description": "Лаконичная модель для теста",
        "description": "Описание тестового товара.",
        "category_id": uuid4(),
        "price": 10000,
        "variants": [{"size": "44", "stock_quantity": 2}],
    }
    result.update(changes)
    return result


def test_product_validation_rejects_invalid_price_and_sizes():
    with pytest.raises(ValidationError):
        ProductIn(**payload(price=0))
    with pytest.raises(ValidationError):
        ProductIn(**payload(compare_at_price=10000))
    with pytest.raises(ValidationError):
        ProductIn(**payload(variants=[{"size": "44", "stock_quantity": 1}, {"size": "44", "stock_quantity": 2}]))


def test_admin_mutations_require_authenticated_session():
    with TestClient(app) as client:
        response = client.get("/api/admin/dashboard")
    assert response.status_code == 401
