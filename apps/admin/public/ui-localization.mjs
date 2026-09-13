const labels = new Map([
  ["published", "Опубликован"], ["draft", "Черновик"], ["hidden", "Скрыта"],
  ["Preview", "Предпросмотр"], ["Preview секции", "Предпросмотр секции"], ["Preview → Save", "Предпросмотр → Сохранить"],
  ["Save / Publish", "Сохранить / Опубликовать"], ["Card image", "Изображение карточки"],
  ["Variants JSON", "Варианты (технический формат JSON)"],
  ["Media JSON", "Медиа (технический формат JSON)"],
  ["Characteristics JSON", "Характеристики (технический формат JSON)"],
  ["SKU", "Артикул"], ["Товар, SKU", "Товар, артикул"], ["Entity", "Объект"], ["Action", "Действие"],
  ["Result", "Результат"], ["success", "Успешно"], ["failure", "Ошибка"], ["blocked", "Заблокировано"],
  ["whatsapp", "WhatsApp"], ["telegram", "Telegram"], ["phone", "Телефон"], ["email", "Email"],
  ["delivery", "Доставка"], ["returns", "Возврат"], ["footer", "Подвал сайта"],
  ["seo title", "SEO-заголовок"], ["seo description", "SEO-описание"], ["seoTitle", "SEO-заголовок"],
  ["seoDescription", "SEO-описание"], ["Slug", "Адрес страницы (slug)"], ["Status", "Статус"], ["storefront", "витрину магазина"],
  ["stock", "Остаток"], ["ADMIN", "Администратор"], ["MODERATOR", "Модератор"],
  ["ACTIVE", "Активен"], ["DISABLED", "Отключён"], ["visible", "Видима"], ["disabled", "Отключён"],
  ["auth.login_success", "Успешный вход"], ["auth.login_failure", "Ошибка входа"], ["auth.logout", "Выход"],
  ["products.created", "Товар создан"], ["products.updated", "Товар изменён"], ["products.deleted", "Товар удалён"],
  ["categories.created", "Категория создана"], ["categories.updated", "Категория изменена"],
  ["collections.updated", "Коллекция изменена"], ["media.uploaded", "Медиа загружено"],
  ["inventory.updated", "Остаток изменён"], ["inventory.adjusted", "Остаток изменён"], ["settings.updated", "Настройки изменены"]
]);

export function localizedLabel(value) {
  const text = String(value ?? "");
  const leading = text.match(/^\s*/u)?.[0] ?? "";
  const trailing = text.match(/\s*$/u)?.[0] ?? "";
  const core = text.slice(leading.length, text.length - trailing.length);
  if (labels.has(core)) return `${leading}${labels.get(core)}${trailing}`;
  if (/^[a-z]+(?:\.[a-z_]+)+$/u.test(core)) return `${leading}Системное действие (${core})${trailing}`;
  const embedded = core.replace(/\b(published|draft|hidden|success|failure|blocked|ADMIN|MODERATOR|ACTIVE|DISABLED|storefront)\b/gu, (token) => labels.get(token) ?? token);
  return `${leading}${embedded}${trailing}`;
}

function shouldSkip(node) {
  return node.parentElement?.closest("textarea, input, pre, code, script, style") != null;
}

export function localizeUi(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (shouldSkip(node)) continue;
    const localized = localizedLabel(node.nodeValue);
    if (localized !== node.nodeValue) node.nodeValue = localized;
  }
  for (const element of root.querySelectorAll?.("[placeholder]") ?? []) {
    const localized = localizedLabel(element.getAttribute("placeholder"));
    if (localized !== element.getAttribute("placeholder")) element.setAttribute("placeholder", localized);
  }
}

export function observeUiLocalization(root) {
  localizeUi(root);
  const observer = new MutationObserver(() => localizeUi(root));
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return observer;
}
