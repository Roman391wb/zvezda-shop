"""storefront v2 CMS, promotions and mixed product media

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("product_media", sa.Column("variant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("product_media", sa.Column("is_secondary", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_foreign_key("fk_product_media_variant", "product_media", "product_variants", ["variant_id"], ["id"], ondelete="SET NULL")
    op.create_table(
        "homepage_sections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=50), nullable=False, unique=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="published"),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_homepage_sections_key", "homepage_sections", ["key"])
    op.create_table(
        "discounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=True),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=True),
        sa.Column("percent_off", sa.Integer(), nullable=True),
        sa.Column("fixed_price", sa.Integer(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("show_on_homepage", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("media_url", sa.String(length=500), nullable=True),
    )


def downgrade():
    op.drop_table("discounts")
    op.drop_index("ix_homepage_sections_key", table_name="homepage_sections")
    op.drop_table("homepage_sections")
    op.drop_constraint("fk_product_media_variant", "product_media", type_="foreignkey")
    op.drop_column("product_media", "is_secondary")
    op.drop_column("product_media", "variant_id")
