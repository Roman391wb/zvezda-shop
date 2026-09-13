import type { AdminRole } from "./types";
import { forbidden } from "./errors";

export type Permission =
  | "products.read" | "products.write" | "inventory.manage" | "catalog.manage"
  | "homepage.manage" | "media.manage" | "settings.manage" | "users.manage" | "audit.read"
  | "security.manage" | "rollback.execute";

const moderatorPermissions = new Set<Permission>([
  "products.read", "products.write", "inventory.manage", "catalog.manage", "homepage.manage", "media.manage"
]);

const allPermissions: Permission[] = [
  "products.read", "products.write", "inventory.manage", "catalog.manage", "homepage.manage", "media.manage",
  "settings.manage", "users.manage", "audit.read", "security.manage", "rollback.execute"
];

export function permissionsFor(role: AdminRole): Permission[] {
  return role === "ADMIN" ? allPermissions : allPermissions.filter((permission) => moderatorPermissions.has(permission));
}

export function requirePermission(role: AdminRole, permission: Permission): void {
  if (!permissionsFor(role).includes(permission)) throw forbidden();
}
