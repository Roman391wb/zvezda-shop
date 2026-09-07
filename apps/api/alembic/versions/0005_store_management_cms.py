"""store management cms foundation

Revision ID: 0005
Revises: 0004
"""

from alembic import op


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_title varchar(180), ADD COLUMN IF NOT EXISTS seo_description varchar(320), ADD COLUMN IF NOT EXISTS barcode varchar(80), ADD COLUMN IF NOT EXISTS weight_grams integer, ADD COLUMN IF NOT EXISTS supplier varchar(180), ADD COLUMN IF NOT EXISTS cost_price integer")
    op.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS seo_title varchar(180), ADD COLUMN IF NOT EXISTS seo_description varchar(320)")
    op.execute("ALTER TABLE collections ADD COLUMN IF NOT EXISTS seo_title varchar(180), ADD COLUMN IF NOT EXISTS seo_description varchar(320)")
    op.execute("DO $$ BEGIN CREATE TYPE orderstatus AS ENUM ('NEW','CONFIRMED','PROCESSING','READY','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$")
    op.execute("""CREATE TABLE IF NOT EXISTS homepage_revisions (id uuid PRIMARY KEY, section_key varchar(50) NOT NULL, content jsonb NOT NULL DEFAULT '{}'::jsonb, enabled boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, status varchar(20) NOT NULL DEFAULT 'published', created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_homepage_revisions_section_key ON homepage_revisions(section_key)")
    op.execute("""CREATE TABLE IF NOT EXISTS media_assets (id uuid PRIMARY KEY, storage_key varchar(500) NOT NULL UNIQUE, url varchar(500) NOT NULL UNIQUE, mime_type varchar(100) NOT NULL, width integer, height integer, size_bytes integer NOT NULL, alt_text varchar(240), usage_metadata jsonb, created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    op.execute("""CREATE TABLE IF NOT EXISTS inventory_movements (id uuid PRIMARY KEY, variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT, delta integer NOT NULL, balance_after integer NOT NULL, reason varchar(40) NOT NULL, note text, actor_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_inventory_movements_variant_id ON inventory_movements(variant_id)")
    op.execute("""CREATE TABLE IF NOT EXISTS store_settings (id integer PRIMARY KEY, content jsonb NOT NULL DEFAULT '{}'::jsonb, updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    op.execute("""CREATE TABLE IF NOT EXISTS orders (id uuid PRIMARY KEY, public_number varchar(32) NOT NULL UNIQUE, status orderstatus NOT NULL DEFAULT 'NEW', customer_name varchar(180) NOT NULL, phone varchar(60) NOT NULL, email varchar(180), whatsapp varchar(60), delivery_method varchar(80) NOT NULL DEFAULT 'whatsapp', delivery_address text, comment text, internal_note text, subtotal integer NOT NULL, discount_total integer NOT NULL DEFAULT 0, delivery_total integer NOT NULL DEFAULT 0, total integer NOT NULL, currency varchar(3) NOT NULL DEFAULT 'RUB', created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_public_number ON orders(public_number)")
    op.execute("""CREATE TABLE IF NOT EXISTS order_items (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id uuid REFERENCES products(id) ON DELETE SET NULL, variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL, product_name varchar(180) NOT NULL, variant_description varchar(240) NOT NULL, sku varchar(80) NOT NULL, quantity integer NOT NULL CHECK (quantity > 0), unit_price integer NOT NULL, total_price integer NOT NULL)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_items_order_id ON order_items(order_id)")
    op.execute("""CREATE TABLE IF NOT EXISTS order_status_history (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE, status orderstatus NOT NULL, note text, actor_admin_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_status_history_order_id ON order_status_history(order_id)")


def downgrade():
    # Intentionally conservative: production downgrade retains business records.
    pass
