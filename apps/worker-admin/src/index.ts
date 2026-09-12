import { getConfig, type Config } from "./config";
import { sha256, sha256Bytes } from "./crypto";
import { AppError } from "./errors";
import { GitHubReader } from "./github-reader";
import { validateImage } from "./image-validation";
import { GitHubWriter, type GitWriterPort } from "./github-writer";
import { ContentService, type MutationActor } from "./content-service";
import { apiCookie, csrfCookie, errorResponse, expiredApiCookie, expiredCsrfCookie, json, readJson, requestId } from "./http";
import { passwordHasher, type PasswordHasher, verifyPassword } from "./password";
import { permissionsFor, requirePermission, type Permission } from "./permissions";
import { currentSession, enforceCsrf, newSession, requestHash } from "./session";
import { D1AdminStore, type AdminStore } from "./store";
import type { ContentKey, Env, GitHubDocument } from "./types";

interface ContentReader { readByKey(key: ContentKey): Promise<GitHubDocument>; }

export interface AppDependencies {
  store?: AdminStore;
  reader?: ContentReader;
  hasher?: PasswordHasher;
  config?: Config;
  writer?: GitWriterPort;
}

export interface AdminWorker {
  fetch(request: Request): Promise<Response>;
}

interface LoginInput { login?: unknown; password?: unknown; }
interface PasswordChangeInput { current_password?: unknown; new_password?: unknown; }
interface UserCreateInput { login?: unknown; password?: unknown; role?: unknown; }
interface UserUpdateInput { role?: unknown; is_active?: unknown; }

function originFor(request: Request, config: Config, unsafe = false): string | null {
  const origin = request.headers.get("Origin");
  if (origin && !config.allowedOrigins.has(origin)) throw new AppError(403, "origin_not_allowed", "Origin не разрешён");
  if (unsafe && (!origin || !config.allowedOrigins.has(origin))) throw new AppError(403, "origin_not_allowed", "Origin не разрешён");
  return origin;
}

function addCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function preflight(request: Request, config: Config, id: string): Response {
  const origin = originFor(request, config, true);
  if (!origin) throw new AppError(403, "origin_not_allowed", "Origin не разрешён");
  const requestedMethod = request.headers.get("Access-Control-Request-Method") ?? "";
  if (!requestedMethod || !["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(requestedMethod)) throw new AppError(405, "method_not_allowed", "Метод не разрешён");
  return json({}, 204, id, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, X-Request-Id, If-Match, Idempotency-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  });
}

function normalizedLogin(value: unknown): string {
  if (typeof value !== "string") throw new AppError(422, "validation_error", "Укажите логин");
  const login = value.trim().toLocaleLowerCase("en-US");
  if (login.length < 3 || login.length > 120) throw new AppError(422, "validation_error", "Логин должен содержать от 3 до 120 символов");
  return login;
}

function passwordValue(value: unknown, field = "Пароль"): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 256) throw new AppError(422, "validation_error", `${field} должен содержать от 8 до 256 символов`);
  return value;
}
function adminRole(value: unknown): "ADMIN" | "MODERATOR" { if (value === "ADMIN" || value === "MODERATOR") return value; throw new AppError(422, "validation_error", "Некорректная роль"); }
function publicUser(user: import("./types").AdminUser) {
  return { id: user.id, displayLogin: user.displayLogin, role: user.role, isActive: user.isActive, sessionVersion: user.sessionVersion, passwordChangedAt: user.passwordChangedAt, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt, updatedAt: user.updatedAt };
}

function contentObject(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(502, "content_invalid_json", "Некорректная структура контента");
  const result = value as Record<string, unknown>;
  if (!(key in result)) throw new AppError(502, "content_invalid_json", "Некорректная структура контента");
  return result;
}

function contentArray(value: unknown, key: string): Record<string, unknown>[] {
  const items = contentObject(value, key)[key];
  if (!Array.isArray(items) || items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new AppError(502, "content_invalid_json", "Некорректная структура контента");
  return items as Record<string, unknown>[];
}

function ifMatch(request: Request): string {
  const value = request.headers.get("If-Match");
  if (!value) throw new AppError(428, "PRECONDITION_REQUIRED", "Требуется If-Match revision");
  return value.trim().replace(/^W\//iu, "").replace(/^"|"$/gu, "");
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("Idempotency-Key")?.trim();
  if (!value || !/^[A-Za-z0-9._:-]{16,200}$/u.test(value)) throw new AppError(400, "invalid_idempotency_key", "Требуется корректный Idempotency-Key");
  return value;
}

function toTaxonomyResponse(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.map((item) => ({ ...item, id: item.slug, is_active: item.is_visible !== false }));
}


async function readFor(reader: ContentReader, key: ContentKey): Promise<unknown> {
  return (await reader.readByKey(key)).value;
}

export function createApp(env: Env, dependencies: AppDependencies = {}): AdminWorker {
  const config = dependencies.config ?? getConfig(env);
  const store = dependencies.store ?? new D1AdminStore(env.DB);
  const reader = dependencies.reader ?? new GitHubReader(config);
  const writer = dependencies.writer ?? new GitHubWriter(config);
  const content = new ContentService(writer, store);
  const hasher = dependencies.hasher ?? passwordHasher;
  const secure = config.environment !== "development";

  function assertWriteTarget(): void {
    // A staging Worker must never be able to write a live branch, even if a
    // dashboard variable is changed accidentally. Production remains disabled
    // by configuration and is deliberately not an Admin content-write target.
    const protectedBranches = new Set(["main", "master", "production", "live"]);
    if (config.environment === "staging" && (protectedBranches.has(config.githubRef) || config.githubRef !== "admin-staging")) {
      throw new AppError(503, "WRITE_TARGET_BLOCKED", "Запись в выбранную ветку запрещена политикой окружения");
    }
  }

  async function authenticated(request: Request, permission?: Permission) {
    const current = await currentSession(store, request);
    if (permission) requirePermission(current.user.role, permission);
    return current;
  }

  async function contentMutation<T>(request: Request, operation: string, permission: Permission, bodyFingerprint: string, handler: (actor: MutationActor) => Promise<T>): Promise<T> {
    if (!config.writesEnabled) throw new AppError(503, "WRITE_DISABLED", "Изменение контента временно отключено");
    assertWriteTarget();
    const current = await authenticated(request, permission); await enforceCsrf(current, request);
    const rawKey = idempotencyKey(request); const keyHash = await sha256(rawKey); const requestHash = await sha256(`${operation}:${bodyFingerprint}`); const now = Date.now();
    const state = await store.beginIdempotency({ actorUserId: current.user.id, operation, keyHash, requestHash, now });
    if (state.kind === "conflict") throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key уже использован с другим запросом");
    if (state.kind === "pending") throw new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "Запрос с этим Idempotency-Key ещё выполняется");
    if (state.kind === "completed") return state.response as T;
    if (state.kind === "failed") {
      const error = state.response as { error?: { code?: string; detail?: string } };
      throw new AppError(state.status, error.error?.code ?? "request_failed", error.error?.detail ?? "Повторный запрос завершился ошибкой");
    }
    try {
      const result = await handler({ id: current.user.id, role: current.user.role, requestId: requestId(request) });
      await store.completeIdempotency({ actorUserId: current.user.id, operation, keyHash, status: 200, response: result }); return result;
    } catch (error) {
      const response = error instanceof AppError ? { error: { code: error.code, detail: error.detail } } : { error: { code: "internal_error" } };
      await store.audit({ actorUserId: current.user.id, action: `${operation}.failed`, requestId: requestId(request), outcome: "failure", metadata: { error_code: error instanceof AppError ? error.code : "internal_error" } });
      await store.failIdempotency({ actorUserId: current.user.id, operation, keyHash, status: error instanceof AppError ? error.status : 500, response }); throw error;
    }
  }

  async function jsonMutation<T>(request: Request, operation: string, permission: Permission, handler: (body: unknown, actor: MutationActor) => Promise<T>): Promise<T> {
    const raw = await request.clone().text(); const body = await readJson<unknown>(request);
    return contentMutation(request, operation, permission, raw, (actor) => handler(body, actor));
  }

  async function login(request: Request, id: string): Promise<Response> {
    const payload = await readJson<LoginInput>(request);
    const login = normalizedLogin(payload.login);
    const password = passwordValue(payload.password);
    if (!config.ipHashPepper) throw new AppError(503, "configuration_error", "Не настроена защита входа");
    const attemptKey = await sha256(`${config.ipHashPepper}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}:${login}`);
    const ipHash = await requestHash(request.headers.get("CF-Connecting-IP") ?? "unknown", config.ipHashPepper);
    const limit = await store.recordAttempt(attemptKey, Date.now());
    if (!limit.allowed) {
      await store.audit({ action: "auth.login_failure", requestId: id, ipHash, metadata: { reason: "rate_limited", login_hash: await sha256(login) } });
      throw new AppError(429, "rate_limited", "Слишком много попыток входа. Попробуйте позже.", { "Retry-After": String(limit.retryAfterSeconds) });
    }
    const user = await store.findUserByLogin(login);
    const verification = user?.isActive && hasher === passwordHasher ? await verifyPassword(password, user.passwordHash) : null;
    const valid = user ? user.isActive && (verification?.valid ?? await hasher.verify(password, user.passwordHash)) : false;
    if (!valid || !user) {
      await store.audit({ action: "auth.login_failure", requestId: id, ipHash, metadata: { reason: "invalid_credentials", login_hash: await sha256(login), password_verification: verification?.status, password_verification_error: verification?.errorName } });
      throw new AppError(401, "invalid_credentials", "Неверный логин или пароль");
    }
    const created = await newSession(store, user.id, user.sessionVersion, request, config.ipHashPepper);
    await store.clearAttempts(attemptKey);
    await store.audit({ actorUserId: user.id, action: "auth.login_success", requestId: id, ipHash });
    await store.markUserLoggedIn(user.id, Date.now());
    const headers = new Headers();
    headers.append("Set-Cookie", apiCookie(created.cookieValue, secure));
    headers.append("Set-Cookie", csrfCookie(created.csrfToken, secure));
    return json({ authenticated: true, login: user.displayLogin, role: user.role, permissions: permissionsFor(user.role), csrf_token: created.csrfToken }, 200, id, headers);
  }

  async function me(request: Request, id: string): Promise<Response> {
    try {
      const current = await authenticated(request);
      return json({ authenticated: true, login: current.user.displayLogin, role: current.user.role, permissions: permissionsFor(current.user.role), csrf_token: current.csrfToken || undefined }, 200, id);
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 401) throw error;
      const headers = new Headers();
      headers.append("Set-Cookie", expiredApiCookie(secure));
      headers.append("Set-Cookie", expiredCsrfCookie(secure));
      return json({ error: { code: error.code, detail: error.detail }, authenticated: false, request_id: id }, 401, id, headers);
    }
  }

  async function logout(request: Request, id: string): Promise<Response> {
    const current = await authenticated(request);
    await enforceCsrf(current, request);
    await store.revokeSession(current.session.id, Date.now());
    await store.audit({ actorUserId: current.user.id, action: "auth.logout", requestId: id });
    const headers = new Headers();
    headers.append("Set-Cookie", expiredApiCookie(secure));
    headers.append("Set-Cookie", expiredCsrfCookie(secure));
    return json({ authenticated: false }, 200, id, headers);
  }

  async function changePassword(request: Request, id: string): Promise<Response> {
    const current = await authenticated(request);
    await enforceCsrf(current, request);
    const payload = await readJson<PasswordChangeInput>(request);
    const currentPassword = passwordValue(payload.current_password, "Текущий пароль");
    const newPassword = passwordValue(payload.new_password, "Новый пароль");
    if (!await hasher.verify(currentPassword, current.user.passwordHash)) {
      await store.audit({ actorUserId: current.user.id, action: "auth.password_change_failure", requestId: id, metadata: { reason: "invalid_current_password" } });
      throw new AppError(401, "invalid_credentials", "Текущий пароль указан неверно");
    }
    if (currentPassword === newPassword) throw new AppError(422, "validation_error", "Новый пароль должен отличаться от текущего");
    await store.changePassword(current.user.id, await hasher.hash(newPassword), hasher.algorithm, Date.now());
    await store.audit({ actorUserId: current.user.id, action: "auth.password_changed", requestId: id });
    const headers = new Headers();
    headers.append("Set-Cookie", expiredApiCookie(secure));
    headers.append("Set-Cookie", expiredCsrfCookie(secure));
    return json({ authenticated: false, detail: "Пароль изменён. Войдите снова." }, 200, id, headers);
  }

  async function dashboard(request: Request, id: string): Promise<Response> {
    const current = await authenticated(request, "products.read");
    const [productsValue, categoriesValue, collectionsValue] = await Promise.all([readFor(reader, "products"), readFor(reader, "categories"), readFor(reader, "collections")]);
    const products = contentArray(productsValue, "products"); const categories = contentArray(categoriesValue, "categories"); const collections = contentArray(collectionsValue, "collections");
    const total = products.length;
    const published = products.filter((product) => product.status === "published").length;
    const hidden = products.filter((product) => product.status === "hidden" || product.status === "draft").length;
    const withoutCardImage = products.filter((product) => !product.cardImage).length;
    const withoutStock = products.filter((product) => !Array.isArray(product.variants) || product.variants.reduce((sum, variant) => sum + Number((variant as Record<string, unknown>).stock_quantity ?? 0), 0) <= 0).length;
    const recentAudit = current.user.role === "ADMIN" && store.listAudit ? await store.listAudit({ limit: 8 }) : [];
    return json({ total, published, hidden, without_card_image: withoutCardImage, without_stock: withoutStock, categories: categories.length, collections: collections.length, recent_audit: recentAudit }, 200, id);
  }

  async function products(request: Request, id: string, productId?: string): Promise<Response> {
    await authenticated(request, "products.read");
    const document = await reader.readByKey("products"); const items = contentArray(document.value, "products");
    if (productId) {
      const product = items.find((item) => item.id === productId);
      if (!product) throw new AppError(404, "product_not_found", "Товар не найден");
      return json(product, 200, id, { ETag: `"${document.sha}"` });
    }
    const query = requestUrl(request).searchParams.get("q")?.trim().toLocaleLowerCase("ru-RU") ?? "";
    const status = requestUrl(request).searchParams.get("status")?.trim() ?? "";
    const filtered = items.filter((product) => (!query || String(product.name ?? "").toLocaleLowerCase("ru-RU").includes(query)) && (!status || product.status === status));
    return json(filtered, 200, id, { ETag: `"${document.sha}"` });
  }

  async function taxonomy(request: Request, id: string, key: "categories" | "collections"): Promise<Response> {
    await authenticated(request, "catalog.manage");
    const document = await reader.readByKey(key); return json(toTaxonomyResponse(contentArray(document.value, key)), 200, id, { ETag: `"${document.sha}"` });
  }

  async function homepage(request: Request, id: string): Promise<Response> {
    await authenticated(request, "homepage.manage");
    const document = await reader.readByKey("homepage"); return json(contentArray(document.value, "sections"), 200, id, { ETag: `"${document.sha}"` });
  }

  async function settings(request: Request, id: string): Promise<Response> {
    await authenticated(request, "settings.manage");
    const document = await reader.readByKey("settings"); return json(contentObject(document.value, "settings").settings, 200, id, { ETag: `"${document.sha}"` });
  }

  async function createProduct(request: Request, id: string): Promise<Response> {
    const result = await jsonMutation(request, "products.create", "products.write", (body, actor) => content.createProduct(body, ifMatch(request), actor));
    return json(result, 201, id, { ETag: `"${result.revision ?? ""}"` });
  }
  async function updateProduct(request: Request, id: string, productId: string): Promise<Response> {
    const result = await jsonMutation(request, `products.update:${productId}`, "products.write", (body, actor) => content.updateProduct(productId, body, ifMatch(request), actor));
    return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` });
  }
  async function previewProduct(request: Request, id: string, productId: string): Promise<Response> {
    const current = await authenticated(request, "products.write"); await enforceCsrf(current, request);
    const result = await content.previewProductUpdate(productId, await readJson(request), ifMatch(request));
    return json(result, 200, id, { ETag: `"${result.revision}"` });
  }
  async function deleteProduct(request: Request, id: string, productId: string): Promise<Response> {
    const result = await contentMutation(request, `products.delete:${productId}`, "products.write", "", (actor) => content.deleteProduct(productId, ifMatch(request), actor)); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` });
  }
  async function inventoryHistory(request: Request, id: string, productId: string): Promise<Response> { await authenticated(request, "products.read"); return json(await content.inventory(productId), 200, id); }
  async function adjustInventory(request: Request, id: string, variantId: string): Promise<Response> { const result = await jsonMutation(request, `inventory.adjust:${variantId}`, "inventory.manage", (body, actor) => content.adjustInventory(variantId, body, ifMatch(request), actor)); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` }); }
  async function createTaxonomy(request: Request, id: string, kind: "categories" | "collections"): Promise<Response> { const result = await jsonMutation(request, `${kind}.create`, "catalog.manage", (body, actor) => content.createTaxonomy(kind, body, ifMatch(request), actor)); return json(result, 201, id, { ETag: `"${result.revision ?? ""}"` }); }
  async function updateTaxonomy(request: Request, id: string, kind: "categories" | "collections", itemId: string): Promise<Response> { const result = await jsonMutation(request, `${kind}.update:${itemId}`, "catalog.manage", (body, actor) => content.updateTaxonomy(kind, itemId, body, ifMatch(request), actor)); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` }); }
  async function deleteTaxonomy(request: Request, id: string, kind: "categories" | "collections", itemId: string): Promise<Response> { const result = await contentMutation(request, `${kind}.delete:${itemId}`, "catalog.manage", "", (actor) => content.deleteTaxonomy(kind, itemId, ifMatch(request), actor)); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` }); }
  async function updateHomepage(request: Request, id: string, key: string): Promise<Response> { const result = await jsonMutation(request, `homepage.update:${key}`, "homepage.manage", (body, actor) => content.updateHomepage(key, body, ifMatch(request), actor)); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` }); }
  async function homepageRevisions(request: Request, id: string, key: string): Promise<Response> { await authenticated(request, "homepage.manage"); return json(await content.homepageRevisions(key), 200, id); }
  async function rollbackHomepage(request: Request, id: string, key: string, commitSha: string): Promise<Response> { const result = await contentMutation(request, `homepage.rollback:${key}:${commitSha}`, "rollback.execute", "", (actor) => { if (actor.role !== "ADMIN") throw new AppError(403, "forbidden", "Rollback доступен только ADMIN"); return content.rollbackHomepage(key, commitSha, ifMatch(request), actor); }); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` }); }
  async function updateSettings(request: Request, id: string): Promise<Response> { const result = await jsonMutation(request, "settings.update", "settings.manage", (body, actor) => content.updateSettings(body, ifMatch(request), actor)); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` }); }
  function managedUsers() { if (!store.listUsers || !store.createUser || !store.updateUser) throw new AppError(503, "users_not_configured", "Управление пользователями не настроено"); return store as Required<Pick<AdminStore, "listUsers" | "createUser" | "updateUser">> & AdminStore; }
  async function users(request: Request, id: string): Promise<Response> { await authenticated(request, "users.manage"); return json((await managedUsers().listUsers()).map(publicUser), 200, id); }
  async function createUser(request: Request, id: string): Promise<Response> {
    const result = await jsonMutation(request, "users.create", "users.manage", async (body, actor) => {
      if (actor.role !== "ADMIN") throw new AppError(403, "forbidden", "Доступно только ADMIN"); const payload = body as UserCreateInput; const login = normalizedLogin(payload.login); const password = passwordValue(payload.password); const role = adminRole(payload.role ?? "MODERATOR"); const managed = managedUsers();
      if (await store.findUserByLogin(login)) throw new AppError(409, "duplicate_login", "Логин уже используется"); const now = Date.now(); const user = { id: crypto.randomUUID(), loginNormalized: login, displayLogin: login, passwordHash: await hasher.hash(password), passwordAlgorithm: hasher.algorithm, role, isActive: true, sessionVersion: 1, passwordChangedAt: now, lastLoginAt: null, createdAt: now, updatedAt: now } as import("./types").AdminUser;
      await managed.createUser(user); await store.audit({ actorUserId: actor.id, targetUserId: user.id, action: "users.created", targetType: "user", targetId: user.id, requestId: actor.requestId, metadata: { role } }); return publicUser(user);
    }); return json(result, 201, id);
  }
  async function updateUser(request: Request, id: string, userId: string): Promise<Response> {
    const result = await jsonMutation(request, `users.update:${userId}`, "users.manage", async (body, actor) => {
      if (actor.role !== "ADMIN") throw new AppError(403, "forbidden", "Доступно только ADMIN"); const payload = body as UserUpdateInput; const role = payload.role === undefined ? undefined : adminRole(payload.role); const isActive = payload.is_active === undefined ? undefined : payload.is_active === true ? true : payload.is_active === false ? false : (() => { throw new AppError(422, "validation_error", "is_active должен быть boolean"); })();
      if (userId === actor.id && isActive === false) throw new AppError(422, "validation_error", "Нельзя отключить текущую сессию"); const updated = await managedUsers().updateUser(userId, { role, isActive, now: Date.now() }); if (!updated) throw new AppError(404, "user_not_found", "Пользователь не найден"); await store.audit({ actorUserId: actor.id, targetUserId: userId, action: "users.updated", targetType: "user", targetId: userId, requestId: actor.requestId, metadata: { role, is_active: isActive } }); return publicUser(updated);
    }); return json(result, 200, id);
  }
  async function revokeUserSessions(request: Request, id: string, userId: string): Promise<Response> { const result = await contentMutation(request, `users.revoke_sessions:${userId}`, "users.manage", "", async (actor) => { if (actor.role !== "ADMIN") throw new AppError(403, "forbidden", "Доступно только ADMIN"); if (!await store.findUserById(userId)) throw new AppError(404, "user_not_found", "Пользователь не найден"); await store.revokeUserSessions(userId, Date.now()); await store.audit({ actorUserId: actor.id, targetUserId: userId, action: "users.sessions_revoked", targetType: "user", targetId: userId, requestId: actor.requestId }); return { revoked: true }; }); return json(result, 200, id); }
  async function media(request: Request, id: string): Promise<Response> {
    await authenticated(request, "media.manage");
    const [items, head] = await Promise.all([content.listMedia(), writer.head()]);
    return json(items, 200, id, { ETag: `"${head}"` });
  }
  async function uploadMedia(request: Request, id: string): Promise<Response> {
    const raw = new Uint8Array(await request.clone().arrayBuffer()); const form = await request.formData(); const candidate = form.get("file");
    if (!(candidate instanceof File)) throw new AppError(422, "validation_error", "Требуется файл изображения");
    const bytes = new Uint8Array(await candidate.arrayBuffer()); const kind = validateImage(bytes); if (candidate.type && candidate.type !== kind.mime) throw new AppError(422, "invalid_media", "MIME не соответствует содержимому изображения");
    const result = await contentMutation(request, "media.upload", "media.manage", await sha256Bytes(raw), (actor) => content.uploadMedia(bytes, kind.extension, ifMatch(request), actor)); return json(result, 201, id);
  }
  async function patchMedia(request: Request, id: string, mediaId: string): Promise<Response> { const result = await jsonMutation(request, `media.patch:${mediaId}`, "media.manage", (body, actor) => content.patchMedia(mediaId, body, ifMatch(request), actor)); return json(result, 200, id, { ETag: `"${result.revision ?? ""}"` }); }
  async function deleteMedia(request: Request, id: string, mediaId: string): Promise<Response> { const result = await contentMutation(request, `media.delete:${mediaId}`, "media.manage", "", (actor) => content.deleteMedia(mediaId, ifMatch(request), actor)); return json(result, 200, id); }
  async function publishStatus(request: Request, id: string, commitSha: string): Promise<Response> { await authenticated(request, "products.read"); const stored = await store.publishJob(commitSha); if (!stored) throw new AppError(404, "publish_not_found", "Publish job не найден"); const run = await writer.workflowForCommit(commitSha); if (run) { const status = run.conclusion === "success" ? "success" : run.conclusion === "failure" ? "failure" : run.status === "in_progress" ? "in_progress" : "queued"; await store.updatePublishJob(commitSha, status, run.url, Date.now()); return json({ ...stored, status, deployment_url: run.url, saved: true, published: status === "success" }, 200, id); } return json({ ...stored, saved: true, published: false }, 200, id); }
  async function latestDeployment(request: Request, id: string): Promise<Response> { await authenticated(request, "products.read"); const latest = await store.latestPublishJob(); return json(latest ? { ...latest, saved: true, published: latest.status === "success" } : { status: "none" }, 200, id); }
  async function audit(request: Request, id: string): Promise<Response> {
    await authenticated(request, "audit.read"); if (!store.listAudit) throw new AppError(503, "audit_not_configured", "Аудит не настроен");
    const query = requestUrl(request).searchParams; const date = (name: string) => { const value = query.get(name); if (!value) return undefined; const parsed = Date.parse(value); return Number.isNaN(parsed) ? undefined : parsed; };
    return json(await store.listAudit({ user: query.get("user")?.trim() || undefined, action: query.get("action")?.trim() || undefined, entity: query.get("entity")?.trim() || undefined, outcome: query.get("outcome")?.trim() || undefined, from: date("from"), to: date("to"), limit: Number(query.get("limit") ?? 100) }), 200, id);
  }

  function requestUrl(request: Request): URL { return new URL(request.url); }

  return {
    async fetch(request): Promise<Response> {
      const id = requestId(request);
      let origin: string | null = null;
      try {
        if (!requestUrl(request).pathname.startsWith("/api/admin/")) throw new AppError(404, "not_found", "Маршрут не найден");
        if (request.method === "OPTIONS") return preflight(request, config, id);
        origin = originFor(request, config, ["POST", "PUT", "PATCH", "DELETE"].includes(request.method));
        const path = requestUrl(request).pathname;
        let response: Response;
        if (request.method === "POST" && path === "/api/admin/auth/login") response = await login(request, id);
        else if (request.method === "POST" && path === "/api/admin/auth/logout") response = await logout(request, id);
        else if (request.method === "GET" && path === "/api/admin/auth/me") response = await me(request, id);
        else if (request.method === "POST" && path === "/api/admin/auth/password/change") response = await changePassword(request, id);
        else if (request.method === "GET" && path === "/api/admin/dashboard") response = await dashboard(request, id);
        else if (request.method === "GET" && path === "/api/admin/products") response = await products(request, id);
        else if (request.method === "POST" && path === "/api/admin/products") response = await createProduct(request, id);
        else if (request.method === "POST" && /^\/api\/admin\/products\/[^/]+\/preview$/u.test(path)) response = await previewProduct(request, id, decodeURIComponent(path.split("/")[4] ?? ""));
        else if (request.method === "GET" && /^\/api\/admin\/products\/[^/]+\/inventory$/u.test(path)) response = await inventoryHistory(request, id, decodeURIComponent(path.split("/")[4] ?? ""));
        else if (request.method === "PUT" && /^\/api\/admin\/products\/[^/]+$/u.test(path)) response = await updateProduct(request, id, decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "DELETE" && /^\/api\/admin\/products\/[^/]+$/u.test(path)) response = await deleteProduct(request, id, decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "GET" && /^\/api\/admin\/products\/[^/]+$/u.test(path)) response = await products(request, id, decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "GET" && path === "/api/admin/categories") response = await taxonomy(request, id, "categories");
        else if (request.method === "POST" && path === "/api/admin/categories") response = await createTaxonomy(request, id, "categories");
        else if (request.method === "PUT" && /^\/api\/admin\/categories\/[^/]+$/u.test(path)) response = await updateTaxonomy(request, id, "categories", decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "DELETE" && /^\/api\/admin\/categories\/[^/]+$/u.test(path)) response = await deleteTaxonomy(request, id, "categories", decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "GET" && path === "/api/admin/collections") response = await taxonomy(request, id, "collections");
        else if (request.method === "POST" && path === "/api/admin/collections") response = await createTaxonomy(request, id, "collections");
        else if (request.method === "PUT" && /^\/api\/admin\/collections\/[^/]+$/u.test(path)) response = await updateTaxonomy(request, id, "collections", decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "DELETE" && /^\/api\/admin\/collections\/[^/]+$/u.test(path)) response = await deleteTaxonomy(request, id, "collections", decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "GET" && path === "/api/admin/homepage") response = await homepage(request, id);
        else if (request.method === "GET" && /^\/api\/admin\/homepage\/[^/]+\/revisions$/u.test(path)) response = await homepageRevisions(request, id, decodeURIComponent(path.split("/")[4] ?? ""));
        else if (request.method === "POST" && /^\/api\/admin\/homepage\/[^/]+\/rollback\/[0-9a-f]{7,64}$/iu.test(path)) response = await rollbackHomepage(request, id, decodeURIComponent(path.split("/")[4] ?? ""), path.split("/")[6] ?? "");
        else if (request.method === "PUT" && /^\/api\/admin\/homepage\/[^/]+$/u.test(path)) response = await updateHomepage(request, id, decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "GET" && path === "/api/admin/settings") response = await settings(request, id);
        else if (request.method === "PUT" && path === "/api/admin/settings") response = await updateSettings(request, id);
        else if (request.method === "GET" && path === "/api/admin/users") response = await users(request, id);
        else if (request.method === "POST" && path === "/api/admin/users") response = await createUser(request, id);
        else if (request.method === "PUT" && /^\/api\/admin\/users\/[^/]+$/u.test(path)) response = await updateUser(request, id, decodeURIComponent(path.split("/").at(-1) ?? ""));
        else if (request.method === "POST" && /^\/api\/admin\/users\/[^/]+\/revoke-sessions$/u.test(path)) response = await revokeUserSessions(request, id, decodeURIComponent(path.split("/")[4] ?? ""));
        else if (request.method === "GET" && path === "/api/admin/media") response = await media(request, id);
        else if (request.method === "POST" && path === "/api/admin/media") response = await uploadMedia(request, id);
        else if (request.method === "PATCH" && /^\/api\/admin\/media\/[0-9a-f-]{36}$/iu.test(path)) response = await patchMedia(request, id, path.split("/").at(-1) ?? "");
        else if (request.method === "DELETE" && /^\/api\/admin\/media\/[0-9a-f-]{36}$/iu.test(path)) response = await deleteMedia(request, id, path.split("/").at(-1) ?? "");
        else if (request.method === "POST" && /^\/api\/admin\/variants\/[^/]+\/inventory$/u.test(path)) response = await adjustInventory(request, id, decodeURIComponent(path.split("/")[4] ?? ""));
        else if (request.method === "GET" && /^\/api\/admin\/publish\/[0-9a-f]{7,64}$/iu.test(path)) response = await publishStatus(request, id, path.split("/").at(-1) ?? "");
        else if (request.method === "GET" && path === "/api/admin/deployment/latest") response = await latestDeployment(request, id);
        else if (request.method === "GET" && path === "/api/admin/audit") response = await audit(request, id);
        else throw new AppError(404, "not_found", "Маршрут не найден");
        return addCors(response, origin);
      } catch (error) {
        return addCors(errorResponse(error, id), origin);
      }
    }
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createApp(env).fetch(request);
  }
} satisfies ExportedHandler<Env>;
