import enum

from .models import AdminRole


class Permission(str, enum.Enum):
    users_manage = "users.manage"
    products_read = "products.read"
    products_write = "products.write"
    catalog_manage = "catalog.manage"
    homepage_manage = "homepage.manage"
    media_manage = "media.manage"
    inventory_manage = "inventory.manage"
    discounts_manage = "discounts.manage"
    settings_manage = "settings.manage"
    orders_read = "orders.read"
    orders_manage = "orders.manage"
    audit_read = "audit.read"


ADMIN_PERMISSIONS = frozenset(Permission)
MODERATOR_PERMISSIONS = frozenset({
    Permission.products_read,
    Permission.products_write,
    Permission.catalog_manage,
    Permission.homepage_manage,
    Permission.media_manage,
    Permission.inventory_manage,
    Permission.discounts_manage,
    Permission.orders_read,
    Permission.orders_manage,
})


def permissions_for(role: AdminRole) -> frozenset[Permission]:
    return ADMIN_PERMISSIONS if role == AdminRole.ADMIN else MODERATOR_PERMISSIONS


def has_permission(role: AdminRole, permission: Permission) -> bool:
    return permission in permissions_for(role)
