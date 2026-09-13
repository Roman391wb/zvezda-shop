export const MIN_PRICE_KOPECKS = 1;
export const MAX_PRICE_KOPECKS = 1_000_000_000;

const groupedInteger = /^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)$/u;
const amount = /^([^.,]+)(?:([.,])(\d{1,2}))?$/u;

export function parseRubles(value, { min = MIN_PRICE_KOPECKS, max = MAX_PRICE_KOPECKS } = {}) {
  if (typeof value !== "string") throw new Error("Укажите цену в рублях");
  const source = value.trim();
  if (!source) throw new Error("Укажите цену в рублях");
  const match = source.match(amount);
  if (!match || !groupedInteger.test(match[1])) throw new Error("Введите цену в рублях, например 3500 или 3500,50");
  const rubles = match[1].replace(/[ \u00a0\u202f]/gu, "");
  const fraction = (match[3] ?? "").padEnd(2, "0");
  const kopecks = BigInt(rubles) * 100n + BigInt(fraction || "0");
  if (kopecks < BigInt(min) || kopecks > BigInt(max)) throw new Error("Цена находится вне допустимого диапазона");
  return Number(kopecks);
}

export function kopecksToRublesInput(value) {
  if (!Number.isSafeInteger(value) || value < MIN_PRICE_KOPECKS || value > MAX_PRICE_KOPECKS) throw new Error("Некорректная цена в API");
  const rubles = Math.floor(value / 100);
  const kopecks = value % 100;
  return kopecks ? `${rubles},${String(kopecks).padStart(2, "0")}` : String(rubles);
}

export function formatMoney(value) {
  if (!Number.isSafeInteger(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: value % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(value / 100)} ₽`;
}

const statuses = {
  published: "Опубликован",
  draft: "Черновик",
  hidden: "Скрыт",
  out_of_stock: "Нет в наличии"
};

const sections = {
  hero: "Главный баннер",
  categories: "Категории",
  new: "Новинки",
  featured: "Популярные товары",
  promo: "Промоблок",
  benefits: "Преимущества",
  cinematic: "Видеоблок"
};

const roles = { ADMIN: "Администратор", MODERATOR: "Модератор" };

const actions = {
  "auth.login_success": "Успешный вход",
  "auth.login_failure": "Ошибка входа",
  "auth.logout": "Выход",
  "products.created": "Товар создан",
  "products.updated": "Товар изменён",
  "products.deleted": "Товар удалён",
  "categories.created": "Категория создана",
  "categories.updated": "Категория изменена",
  "collections.created": "Коллекция создана",
  "collections.updated": "Коллекция изменена",
  "media.uploaded": "Изображение загружено",
  "media.deleted": "Изображение удалено",
  "inventory.updated": "Остаток изменён",
  "inventory.adjusted": "Остаток изменён",
  "homepage.updated": "Блок главной изменён",
  "settings.updated": "Настройки изменены"
};

export const statusLabel = value => statuses[value] ?? String(value ?? "—");
export const sectionLabel = value => sections[value] ?? String(value ?? "—");
export const roleLabel = value => roles[value] ?? String(value ?? "—");
export const actionLabel = value => actions[value] ?? `Системное действие (${String(value ?? "—")})`;

const usageSections = { products: "Товары", categories: "Категории", collections: "Коллекции", homepage: "Главная страница", settings: "Настройки" };
export const usageLabels = references => [...new Set((references ?? []).map(reference => usageSections[String(reference).split(".")[0]] ?? "Другое содержимое"))];

export function mediaPreviewUrl(apiBase, canonicalUrl) {
  return `${String(apiBase ?? "").replace(/\/$/u, "")}/media/preview?url=${encodeURIComponent(canonicalUrl)}`;
}

export function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function changedProductPayload(original, next) {
  if (!original) return { ...next };
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => !deepEqual(original[key], value)));
}

export function mergeVariant(original, fields) {
  return {
    ...(original ?? {}),
    ...(fields.id ? { id: fields.id } : {}),
    sku: fields.sku,
    options: { ...(original?.options ?? {}), size: fields.size, color: fields.color },
    stock_quantity: fields.stock_quantity,
    is_active: fields.is_active,
    media: Array.isArray(original?.media) ? original.media : []
  };
}

export function mergeAttribute(original, fields) {
  return { ...(original ?? {}), name: fields.name, value: fields.value };
}
