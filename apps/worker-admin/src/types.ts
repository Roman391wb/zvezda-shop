/// <reference types="@cloudflare/workers-types" />

export type AdminRole = "ADMIN" | "MODERATOR";

export interface Env {
  DB: D1Database;
  ENVIRONMENT: "development" | "staging" | "production";
  ALLOWED_ORIGINS: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_REF: string;
  WRITES_ENABLED?: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  IP_HASH_PEPPER?: string;
}

export interface AdminUser {
  id: string;
  loginNormalized: string;
  displayLogin: string;
  passwordHash: string;
  passwordAlgorithm: string;
  role: AdminRole;
  isActive: boolean;
  sessionVersion: number;
  passwordChangedAt: number;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AdminSession {
  id: string;
  userId: string;
  secretHash: string;
  csrfHash: string;
  sessionVersion: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface CurrentSession {
  user: AdminUser;
  session: AdminSession;
  csrfToken: string;
}

export interface GitHubDocument<T = unknown> {
  path: ContentPath;
  sha: string;
  value: T;
}

export const CONTENT_PATHS = {
  products: "content/products.json",
  categories: "content/categories.json",
  collections: "content/collections.json",
  homepage: "content/homepage.json",
  settings: "content/settings.json"
} as const;

export type ContentKey = keyof typeof CONTENT_PATHS;
export type ContentPath = (typeof CONTENT_PATHS)[ContentKey];

export const UPLOADS_PREFIX = "apps/web/public/uploads/" as const;
export type UploadPath = `${typeof UPLOADS_PREFIX}${string}`;
export type WritePath = ContentPath | UploadPath;

export interface GitCommitChange {
  path: WritePath;
  bytes: Uint8Array | null;
}

export interface GitCommitResult {
  commitSha: string;
  revisions: Partial<Record<ContentKey, string>>;
}

export interface GitUploadAsset {
  id: string;
  path: UploadPath;
  url: string;
}
