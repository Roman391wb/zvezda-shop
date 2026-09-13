import { AppError } from "./errors";
import type { GitWriterPort } from "./github-writer";
import type { AdminStore } from "./store";
import { CONTENT_PATHS, UPLOADS_PREFIX, type ContentKey, type GitCommitChange, type GitCommitResult, type GitUploadAsset, type WritePath } from "./types";

type JsonObject = Record<string, unknown>;
const encoder = new TextEncoder();
const productStatuses = new Set(["draft", "published", "hidden", "out_of_stock"]);
const homepageKeys = new Set(["hero", "categories", "new", "cinematic", "featured", "promo", "benefits"]);
const settingKeys = new Set(["store_name", "whatsapp", "telegram", "phone", "email", "delivery", "returns", "footer", "seo_title", "seo_description"]);

export interface MutationActor { id: string; role: "ADMIN" | "MODERATOR"; requestId: string; }
export interface MutationResult { commit_sha: string; revision?: string; path: string; }

function object(value: unknown, message = "Некорректная структура контента"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(422, "validation_error", message);
  return value as JsonObject;
}
function array(value: unknown, message = "Некорректный список"): JsonObject[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new AppError(422, "validation_error", message);
  return value as JsonObject[];
}
function string(value: unknown, field: string, min = 1, max = 500): string {
  if (typeof value !== "string") throw new AppError(422, "validation_error", `Поле ${field} обязательно`);
  const result = value.trim();
  if (result.length < min || result.length > max) throw new AppError(422, "validation_error", `Некорректное поле ${field}`);
  return result;
}
function optionalString(value: unknown, field: string, max = 500): string | null {
  if (value === null || value === undefined || value === "") return null;
  return string(value, field, 1, max);
}
function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new AppError(422, "validation_error", `Некорректное поле ${field}`);
  return value;
}
function boolean(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : value === true ? true : value === false ? false : (() => { throw new AppError(422, "validation_error", "Ожидается boolean"); })();
}
function slug(value: unknown): string {
  const result = string(value, "slug", 2, 120);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(result)) throw new AppError(422, "validation_error", "Некорректный slug");
  return result;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function encoded(value: unknown): Uint8Array { return encoder.encode(`${JSON.stringify(value, null, 2)}\n`); }
function url(value: unknown): string {
  const result = string(value, "media url", 1, 500);
  if (!/^(?:\/images\/|\/uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp)$)/u.test(result)) throw new AppError(422, "validation_error", "Недопустимая ссылка на изображение");
  return result;
}

export class ContentService {
  constructor(private readonly writer: GitWriterPort, private readonly store: AdminStore) {}

  async createProduct(input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    const [productsDoc, categoriesDoc, collectionsDoc] = await Promise.all([this.writer.readByKey("products"), this.writer.readByKey("categories"), this.writer.readByKey("collections")]);
    this.match(productsDoc.sha, expected, "products");
    const products = array(object(productsDoc.value).products, "Некорректный products.json");
    const product = this.normalProduct(input, undefined, array(object(categoriesDoc.value).categories), array(object(collectionsDoc.value).collections));
    if (products.some((item) => item.slug === product.slug)) throw new AppError(409, "duplicate_slug", "Slug уже используется");
    if (product.article && products.some((item) => item.article === product.article)) throw new AppError(409, "duplicate_article", "Артикул уже используется");
    products.push(product);
    return this.commitDocument("products", { products }, productsDoc.sha, `admin: create product ${product.slug}`, actor, { action: "products.created", targetType: "product", targetId: String(product.id), before: null, after: product });
  }

  async updateProduct(id: string, input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    const [productsDoc, categoriesDoc, collectionsDoc] = await Promise.all([this.writer.readByKey("products"), this.writer.readByKey("categories"), this.writer.readByKey("collections")]);
    this.match(productsDoc.sha, expected, "products");
    const products = array(object(productsDoc.value).products); const index = products.findIndex((item) => item.id === id);
    if (index < 0) throw new AppError(404, "product_not_found", "Товар не найден");
    const before = clone(products[index]);
    const product = this.normalProduct(input, before, array(object(categoriesDoc.value).categories), array(object(collectionsDoc.value).collections));
    product.id = id;
    if (products.some((item, itemIndex) => itemIndex !== index && item.slug === product.slug)) throw new AppError(409, "duplicate_slug", "Slug уже используется");
    if (product.article && products.some((item, itemIndex) => itemIndex !== index && item.article === product.article)) throw new AppError(409, "duplicate_article", "Артикул уже используется");
    products[index] = product;
    return this.commitDocument("products", { products }, productsDoc.sha, `admin: update product ${product.slug}`, actor, { action: "products.updated", targetType: "product", targetId: id, before, after: product });
  }

  async previewProductUpdate(id: string, input: unknown, expected: string): Promise<{ revision: string; before: JsonObject; after: JsonObject }> {
    const [productsDoc, categoriesDoc, collectionsDoc] = await Promise.all([this.writer.readByKey("products"), this.writer.readByKey("categories"), this.writer.readByKey("collections")]);
    this.match(productsDoc.sha, expected, "products");
    const products = array(object(productsDoc.value).products); const index = products.findIndex((item) => item.id === id);
    if (index < 0) throw new AppError(404, "product_not_found", "Товар не найден");
    const before = clone(products[index]);
    const after = this.normalProduct(input, before, array(object(categoriesDoc.value).categories), array(object(collectionsDoc.value).collections));
    after.id = id;
    if (products.some((item, itemIndex) => itemIndex !== index && item.slug === after.slug)) throw new AppError(409, "duplicate_slug", "Slug уже используется");
    if (after.article && products.some((item, itemIndex) => itemIndex !== index && item.article === after.article)) throw new AppError(409, "duplicate_article", "Артикул уже используется");
    return { revision: productsDoc.sha, before, after };
  }

  async deleteProduct(id: string, expected: string, actor: MutationActor): Promise<MutationResult> {
    const productsDoc = await this.writer.readByKey("products"); this.match(productsDoc.sha, expected, "products");
    const products = array(object(productsDoc.value).products); const index = products.findIndex((item) => item.id === id);
    if (index < 0) throw new AppError(404, "product_not_found", "Товар не найден");
    const [before] = products.splice(index, 1);
    return this.commitDocument("products", { products }, productsDoc.sha, `admin: delete product ${String(before.slug)}`, actor, { action: "products.deleted", targetType: "product", targetId: id, before, after: null });
  }

  async inventory(productId: string): Promise<Record<string, unknown>[]> { return this.store.inventoryHistory(productId); }

  async adjustInventory(variantId: string, input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    const payload = object(input); const delta = integer(payload.delta, "delta", -100_000, 100_000); if (!delta) throw new AppError(422, "validation_error", "delta не может быть нулевым");
    const reason = string(payload.reason, "reason", 1, 80); const note = optionalString(payload.note, "note", 500);
    const doc = await this.writer.readByKey("products"); this.match(doc.sha, expected, "products");
    const products = array(object(doc.value).products); let found: { product: JsonObject; variant: JsonObject } | null = null;
    for (const product of products) for (const variant of array(product.variants ?? [])) if (variant.id === variantId) found = { product, variant };
    if (!found) throw new AppError(404, "variant_not_found", "Вариант не найден");
    const before = integer(found.variant.stock_quantity, "stock_quantity", 0, 100_000); const after = before + delta;
    if (after < 0) throw new AppError(422, "negative_stock", "Остаток не может быть отрицательным");
    found.variant.stock_quantity = after;
    return this.commitDocument("products", { products }, doc.sha, `admin: inventory ${variantId}`, actor, { action: "inventory.adjusted", targetType: "variant", targetId: variantId, before: { stock_quantity: before }, after: { stock_quantity: after }, extra: { product_id: found.product.id, delta, reason, note } });
  }

  async createTaxonomy(kind: "categories" | "collections", input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    const doc = await this.writer.readByKey(kind); this.match(doc.sha, expected, kind);
    const items = array(object(doc.value)[kind]); const entry = this.normalTaxonomy(input);
    if (items.some((item) => item.slug === entry.slug)) throw new AppError(409, "duplicate_slug", "Slug уже используется");
    items.push(entry); return this.commitDocument(kind, { [kind]: items }, doc.sha, `admin: create ${kind} ${String(entry.slug)}`, actor, { action: `${kind}.created`, targetType: kind.slice(0, -1), targetId: String(entry.slug), before: null, after: entry });
  }

  async updateTaxonomy(kind: "categories" | "collections", id: string, input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    const doc = await this.writer.readByKey(kind); this.match(doc.sha, expected, kind);
    const items = array(object(doc.value)[kind]); const index = items.findIndex((item) => item.slug === id); if (index < 0) throw new AppError(404, "resource_not_found", "Запись не найдена");
    const before = clone(items[index]); const entry = this.normalTaxonomy(input, before); if (entry.slug !== id) await this.ensureTaxonomyUnused(kind, id);
    if (items.some((item, itemIndex) => itemIndex !== index && item.slug === entry.slug)) throw new AppError(409, "duplicate_slug", "Slug уже используется");
    items[index] = entry; return this.commitDocument(kind, { [kind]: items }, doc.sha, `admin: update ${kind} ${String(entry.slug)}`, actor, { action: `${kind}.updated`, targetType: kind.slice(0, -1), targetId: String(entry.slug), before, after: entry });
  }

  async deleteTaxonomy(kind: "categories" | "collections", id: string, expected: string, actor: MutationActor): Promise<MutationResult> {
    await this.ensureTaxonomyUnused(kind, id); const doc = await this.writer.readByKey(kind); this.match(doc.sha, expected, kind);
    const items = array(object(doc.value)[kind]); const index = items.findIndex((item) => item.slug === id); if (index < 0) throw new AppError(404, "resource_not_found", "Запись не найдена");
    const [before] = items.splice(index, 1); return this.commitDocument(kind, { [kind]: items }, doc.sha, `admin: delete ${kind} ${id}`, actor, { action: `${kind}.deleted`, targetType: kind.slice(0, -1), targetId: id, before, after: null });
  }

  async updateHomepage(key: string, input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    if (!homepageKeys.has(key)) throw new AppError(404, "homepage_section_not_found", "Неизвестный блок главной");
    const doc = await this.writer.readByKey("homepage"); this.match(doc.sha, expected, "homepage");
    const sections = array(object(doc.value).sections); const index = sections.findIndex((section) => section.key === key); const before = index >= 0 ? clone(sections[index]) : null;
    const payload = object(input); const status = payload.status ?? before?.status ?? "published";
    if (status !== "draft" && status !== "published") throw new AppError(422, "validation_error", "Некорректный status");
    const section: JsonObject = { key, enabled: boolean(payload.enabled, before?.enabled === true), sort_order: integer(payload.sort_order ?? before?.sort_order ?? 0, "sort_order", 0, 1000), status, content: object(payload.content ?? before?.content ?? {}) };
    this.validateMediaReferences(section.content); if (index >= 0) sections[index] = section; else sections.push(section);
    return this.commitDocument("homepage", { sections }, doc.sha, `admin: update homepage ${key}`, actor, { action: "homepage.updated", targetType: "homepage_section", targetId: key, before, after: section });
  }

  async homepageRevisions(key: string): Promise<{ sha: string; message: string; createdAt: string }[]> { if (!homepageKeys.has(key)) throw new AppError(404, "homepage_section_not_found", "Неизвестный блок главной"); return this.writer.history("homepage"); }

  async rollbackHomepage(key: string, commitSha: string, expected: string, actor: MutationActor): Promise<MutationResult> {
    if (!homepageKeys.has(key)) throw new AppError(404, "homepage_section_not_found", "Неизвестный блок главной");
    const [current, historical] = await Promise.all([this.writer.readByKey("homepage"), this.writer.readByKeyAt("homepage", commitSha)]); this.match(current.sha, expected, "homepage");
    const sections = array(object(current.value).sections); const historicalSection = array(object(historical.value).sections).find((section) => section.key === key); if (!historicalSection) throw new AppError(404, "homepage_section_not_found", "Блок отсутствует в указанной revision");
    const index = sections.findIndex((section) => section.key === key); const before = index >= 0 ? clone(sections[index]) : null; if (index >= 0) sections[index] = clone(historicalSection); else sections.push(clone(historicalSection));
    return this.commitDocument("homepage", { sections }, current.sha, `admin: rollback homepage ${key} from ${commitSha.slice(0, 12)}`, actor, { action: "homepage.rollback", targetType: "homepage_section", targetId: key, before, after: historicalSection, extra: { source_commit_sha: commitSha } });
  }

  async updateSettings(input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    const doc = await this.writer.readByKey("settings"); this.match(doc.sha, expected, "settings"); const before = object(object(doc.value).settings); const payload = object(input); const settings: JsonObject = {};
    for (const key of Object.keys(payload)) if (!settingKeys.has(key)) throw new AppError(422, "validation_error", "Недопустимая настройка");
    for (const key of settingKeys) settings[key] = optionalString(payload[key] ?? before?.[key], key, 1000) ?? "";
    return this.commitDocument("settings", { settings }, doc.sha, "admin: update settings", actor, { action: "settings.updated", targetType: "settings", targetId: "store", before, after: settings });
  }

  async listMedia(): Promise<(GitUploadAsset & { references: string[] })[]> {
    const [assets, products, categories, collections, homepage, settings] = await Promise.all([this.writer.listUploads(), this.writer.readByKey("products"), this.writer.readByKey("categories"), this.writer.readByKey("collections"), this.writer.readByKey("homepage"), this.writer.readByKey("settings")]);
    const documents = [products.value, categories.value, collections.value, homepage.value, settings.value];
    return assets.map((asset) => ({ ...asset, references: documents.flatMap((document, index) => this.references(document, asset.url, ["products", "categories", "collections", "homepage", "settings"][index])) }));
  }

  async uploadMedia(bytes: Uint8Array, extension: "jpg" | "png" | "webp", expectedHead: string, actor: MutationActor): Promise<MutationResult & { id: string; url: string; type: "image" }> {
    const id = crypto.randomUUID(); const path = `${UPLOADS_PREFIX}${id}.${extension}` as WritePath; const commit = await this.commitFiles([{ path, bytes }], `admin: upload image ${id}`, expectedHead, actor, { action: "media.uploaded", targetType: "media", targetId: id, before: null, after: { path } });
    return { ...commit, id, url: `/uploads/${id}.${extension}`, type: "image" };
  }

  async patchMedia(id: string, input: unknown, expected: string, actor: MutationActor): Promise<MutationResult> {
    const doc = await this.writer.readByKey("products"); this.match(doc.sha, expected, "products"); const products = array(object(doc.value).products); const payload = object(input); let changed: { before: JsonObject; after: JsonObject } | null = null;
    for (const key of Object.keys(payload)) if (!["alt_text", "sort_order", "is_primary", "is_secondary", "variant_id"].includes(key)) throw new AppError(422, "validation_error", "Недопустимое поле media");
    for (const product of products) for (const media of array(product.media ?? [])) if (media.id === id) {
      const before = clone(media);
      if ("alt_text" in payload) media.alt_text = optionalString(payload.alt_text, "alt_text", 240) ?? "";
      if ("sort_order" in payload) media.sort_order = integer(payload.sort_order, "sort_order", 0, 10_000);
      if ("is_primary" in payload) media.is_primary = boolean(payload.is_primary, false);
      if ("is_secondary" in payload) media.is_secondary = boolean(payload.is_secondary, false);
      if ("variant_id" in payload && payload.variant_id !== null) media.variant_id = string(payload.variant_id, "variant_id", 1, 80); else if ("variant_id" in payload) media.variant_id = null;
      changed = { before, after: media };
    }
    if (!changed) throw new AppError(404, "media_not_found", "Media asset не найден в товарах");
    return this.commitDocument("products", { products }, doc.sha, `admin: patch media ${id}`, actor, { action: "media.updated", targetType: "media", targetId: id, before: changed.before, after: changed.after });
  }

  async deleteMedia(id: string, expectedHead: string, actor: MutationActor): Promise<MutationResult> {
    const listed = await this.listMedia(); const asset = listed.find((item) => item.id === id); if (!asset) throw new AppError(404, "media_not_found", "Media asset не найден");
    if (asset.references.length) throw new AppError(409, "RESOURCE_IN_USE", "Изображение используется в контенте");
    return this.commitFiles([{ path: asset.path, bytes: null }], `admin: delete image ${id}`, expectedHead, actor, { action: "media.deleted", targetType: "media", targetId: id, before: { path: asset.path }, after: null });
  }

  private normalProduct(input: unknown, existing: JsonObject | undefined, categories: JsonObject[], collections: JsonObject[]): JsonObject {
    const payload = object(input); const name = string(payload.name ?? existing?.name, "name", 2, 180); const productSlug = slug(payload.slug ?? existing?.slug); const price = integer(payload.price ?? existing?.price, "price", 1, 1_000_000_000); const compare = payload.compare_at_price === null ? null : payload.compare_at_price ?? existing?.compare_at_price ?? null;
    if (compare !== null && integer(compare, "compare_at_price", 1, 1_000_000_000) <= price) throw new AppError(422, "validation_error", "Старая цена должна быть больше текущей");
    const categoryValue = payload.category_id ?? payload.category_slug ?? payload.category ?? existing?.category_slug; const category = categories.find((item) => item.slug === categoryValue || item.name === categoryValue); if (!category) throw new AppError(422, "invalid_category", "Указана несуществующая категория");
    const collectionValues = payload.collection_ids ?? payload.collections ?? existing?.collections ?? []; if (!Array.isArray(collectionValues)) throw new AppError(422, "invalid_collection", "Некорректные коллекции");
    const collectionSlugs = collectionValues.map((value) => { const found = collections.find((item) => item.slug === value || item.name === value); if (!found) throw new AppError(422, "invalid_collection", "Указана несуществующая коллекция"); return String(found.slug); });
    if (new Set(collectionSlugs).size !== collectionSlugs.length) throw new AppError(422, "invalid_collection", "Коллекции не должны повторяться");
    const status = payload.status ?? existing?.status ?? "draft"; if (typeof status !== "string" || !productStatuses.has(status)) throw new AppError(422, "validation_error", "Некорректный status");
    const variants = this.normalVariants(payload.variants ?? existing?.variants ?? []); const media = this.normalMedia(payload.media ?? existing?.media ?? []); const attributes = this.normalAttributes(payload.attributes ?? existing?.attributes ?? []);
    const cardImage = Object.hasOwn(payload, "cardImage") ? payload.cardImage : Object.hasOwn(payload, "card_image") ? payload.card_image : existing?.cardImage ?? null;
    const result: JsonObject = { ...(existing ?? {}), id: existing?.id ?? crypto.randomUUID(), name, article: optionalString(payload.article ?? existing?.article, "article", 80), cardImage: cardImage === null || cardImage === "" ? undefined : url(cardImage), slug: productSlug, short_description: string(payload.short_description ?? existing?.short_description, "short_description", 2, 300), description: string(payload.description ?? existing?.description, "description", 2, 10_000), category: category.name, category_slug: category.slug, price, compare_at_price: compare === null ? null : integer(compare, "compare_at_price", 1, 1_000_000_000), currency: "RUB", status, is_featured: boolean(payload.is_featured, existing?.is_featured === true), is_new: boolean(payload.is_new, existing?.is_new === true), collections: collectionSlugs, media, variants, attributes };
    if (existing) {
      const specified = new Set(Object.keys(payload));
      if (["cardImage", "card_image"].some((key) => key in payload)) specified.add("cardImage");
      if (["category", "category_id", "category_slug"].some((key) => key in payload)) { specified.add("category"); specified.add("category_slug"); }
      if (["collections", "collection_ids"].some((key) => key in payload)) specified.add("collections");
      for (const key of Object.keys(result)) if (key !== "id" && !specified.has(key)) {
        if (Object.hasOwn(existing, key)) result[key] = clone(existing[key]); else delete result[key];
      }
    }
    return result;
  }

  private normalVariants(value: unknown): JsonObject[] {
    const variants = array(value, "Некорректные варианты"); if (variants.length > 60) throw new AppError(422, "validation_error", "Слишком много вариантов");
    return variants.map((variant) => { const options = object(variant.options ?? {}); const size = string(variant.size ?? options.size, "size", 1, 40); const color = optionalString(variant.color ?? options.color, "color", 60) ?? ""; return { id: variant.id ?? crypto.randomUUID(), sku: optionalString(variant.sku, "sku", 80) ?? "", options: { size, color }, stock_quantity: integer(variant.stock_quantity ?? 0, "stock_quantity", 0, 100_000), is_active: boolean(variant.is_active, true), media: Array.isArray(variant.media) ? variant.media : [] }; });
  }
  private normalMedia(value: unknown): JsonObject[] { return array(value, "Некорректная media").map((media, index) => ({ id: media.id ?? crypto.randomUUID(), type: "image", url: url(media.url), alt_text: optionalString(media.alt_text, "alt_text", 240) ?? "", sort_order: integer(media.sort_order ?? index, "sort_order", 0, 10_000), is_primary: boolean(media.is_primary, index === 0), is_secondary: boolean(media.is_secondary, false), variant_id: media.variant_id ?? null })); }
  private normalAttributes(value: unknown): JsonObject[] { return array(value, "Некорректные attributes").map((attribute) => ({ name: string(attribute.name, "attribute name", 1, 100), value: string(attribute.value, "attribute value", 1, 240) })); }
  private normalTaxonomy(input: unknown, existing?: JsonObject): JsonObject { const payload = object(input); const media = payload.media_url ?? existing?.media_url ?? null; return { name: string(payload.name ?? existing?.name, "name", 2, 120), slug: slug(payload.slug ?? existing?.slug), description: optionalString(payload.description ?? existing?.description, "description", 1000), media_url: media === null || media === "" ? null : url(media), sort_order: integer(payload.sort_order ?? existing?.sort_order ?? 0, "sort_order", 0, 10_000), is_visible: boolean(payload.is_visible ?? payload.is_active, existing?.is_visible !== false) }; }

  private async ensureTaxonomyUnused(kind: "categories" | "collections", id: string): Promise<void> {
    const products = array(object((await this.writer.readByKey("products")).value).products); const used = kind === "categories" ? products.some((product) => product.category_slug === id) : products.some((product) => Array.isArray(product.collections) && product.collections.includes(id));
    if (used) throw new AppError(409, "RESOURCE_IN_USE", "Запись используется товарами");
  }
  private validateMediaReferences(value: unknown): void { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach((item) => this.validateMediaReferences(item)); return; } for (const [key, item] of Object.entries(value as JsonObject)) { if ((key === "media_url" || key === "poster_url") && item) url(item); else this.validateMediaReferences(item); } }
  private references(value: unknown, target: string, label: string, trail = ""): string[] { if (value === target) return [`${label}${trail}`]; if (Array.isArray(value)) return value.flatMap((item, index) => this.references(item, target, label, `${trail}[${index}]`)); if (value && typeof value === "object") return Object.entries(value as JsonObject).flatMap(([key, item]) => this.references(item, target, label, `${trail}.${key}`)); return []; }
  private match(current: string, expected: string, key: ContentKey): void { if (current !== expected) throw new AppError(409, "CONTENT_CONFLICT", "Контент изменился. Обновите данные и повторите операцию.", { ETag: `"${current}"`, "X-Content-Key": key }); }
  private async commitDocument(key: ContentKey, value: JsonObject, expected: string, message: string, actor: MutationActor, audit: { action: string; targetType: string; targetId: string; before: unknown; after: unknown; extra?: JsonObject }): Promise<MutationResult> { const result = await this.writer.commit([{ path: CONTENT_PATHS[key], bytes: encoded(value) }], { message, expectedRevisions: { [key]: expected } }); return this.afterCommit(result, [CONTENT_PATHS[key]], actor, audit, result.revisions[key]); }
  private async commitFiles(changes: GitCommitChange[], message: string, expectedHead: string, actor: MutationActor, audit: { action: string; targetType: string; targetId: string; before: unknown; after: unknown }): Promise<MutationResult> { const result = await this.writer.commit(changes, { message, expectedHead }); return this.afterCommit(result, changes.map((change) => change.path), actor, audit); }
  private async afterCommit(result: GitCommitResult, paths: string[], actor: MutationActor, audit: { action: string; targetType: string; targetId: string; before: unknown; after: unknown; extra?: JsonObject }, revision?: string): Promise<MutationResult> { await this.store.audit({ actorUserId: actor.id, action: audit.action, targetType: audit.targetType, targetId: audit.targetId, requestId: actor.requestId, commitSha: result.commitSha, metadata: { before: audit.before, after: audit.after, ...(audit.extra ?? {}) } }); await this.store.createPublishJob({ actorUserId: actor.id, commitSha: result.commitSha, paths, now: Date.now() }); return { commit_sha: result.commitSha, revision, path: paths[0] }; }
}
