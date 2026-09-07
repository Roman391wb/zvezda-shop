"""commercial catalog flags and root category"""

from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "is_new" not in {column["name"] for column in sa.inspect(bind).get_columns("products")}:
        op.add_column("products", sa.Column("is_new", sa.Boolean(), nullable=False, server_default=sa.false()))

    categories = sa.table(
        "categories",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String()),
        sa.column("slug", sa.String()),
        sa.column("parent_id", postgresql.UUID(as_uuid=True)),
        sa.column("description", sa.Text()),
        sa.column("sort_order", sa.Integer()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    women_id = bind.execute(sa.select(categories.c.id).where(categories.c.slug == "zhenskoe")).scalar_one_or_none()
    if women_id is None:
        women_id = uuid4()
        now = datetime.utcnow()
        bind.execute(categories.insert().values(id=women_id, name="Женское", slug="zhenskoe", parent_id=None, description="Одежда для выразительных и тихих моментов", sort_order=0, is_active=True, created_at=now, updated_at=now))
    bind.execute(categories.update().where(categories.c.slug != "zhenskoe", categories.c.parent_id.is_(None)).values(parent_id=women_id))

    products = sa.table("products", sa.column("is_featured", sa.Boolean()), sa.column("is_new", sa.Boolean()))
    bind.execute(products.update().values(is_new=products.c.is_featured))


def downgrade():
    bind = op.get_bind()
    if "is_new" in {column["name"] for column in sa.inspect(bind).get_columns("products")}:
        op.drop_column("products", "is_new")
