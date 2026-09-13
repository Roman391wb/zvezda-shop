import { deepEqual, sectionLabel, statusLabel } from "./admin-domain.mjs?v=admin-ux-1";

const clone = value => JSON.parse(JSON.stringify(value));
const fieldLabels = {
  title: "Заголовок", eyebrow: "Надзаголовок", subtitle: "Подзаголовок", cta_label: "Текст кнопки",
  cta_href: "Ссылка кнопки", media_url: "Изображение", poster_url: "Постер", video_url: "Видео",
  text: "Текст", label: "Подпись", items: "Преимущества"
};
const fieldLabel = key => fieldLabels[key] ?? key.replaceAll("_", " ");

function scalarField(key, value, esc) {
  if (typeof value === "boolean") return `<label class="check"><input type="checkbox" data-content-key="${esc(key)}" ${value ? "checked" : ""}>${esc(fieldLabel(key))}</label>`;
  if (typeof value === "number") return `<label>${esc(fieldLabel(key))}<input type="number" data-content-key="${esc(key)}" value="${value}"></label>`;
  const large = String(value ?? "").length > 100;
  return `<label>${esc(fieldLabel(key))}${large ? `<textarea data-content-key="${esc(key)}">${esc(value ?? "")}</textarea>` : `<input data-content-key="${esc(key)}" value="${esc(value ?? "")}">`}</label>`;
}

function contentFields(content, esc) {
  return Object.entries(content).map(([key, value]) => {
    if (["string", "number", "boolean"].includes(typeof value) || value === null) return scalarField(key, value, esc);
    if (Array.isArray(value) && value.every(item => item && typeof item === "object" && !Array.isArray(item))) {
      return `<fieldset class="homepage-items" data-content-list="${esc(key)}"><legend>${esc(fieldLabel(key) === key ? "Элементы" : fieldLabel(key))}</legend>${value.map((item, index) => `<article data-item-index="${index}">${Object.entries(item).filter(([, child]) => ["string", "number", "boolean"].includes(typeof child) || child === null).map(([childKey, child]) => scalarField(childKey, child, esc).replaceAll("data-content-key", "data-item-key")).join("")}</article>`).join("")}</fieldset>`;
    }
    return `<p class="notice">Поле «${esc(fieldLabel(key))}» имеет неподдерживаемую вложенную структуру и будет сохранено без изменений.</p>`;
  }).join("");
}

function display(value, esc) {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return `${value.length} элемент(а)`;
  if (value && typeof value === "object") return "Содержимое блока";
  return esc(value ?? "—");
}

function contentPreviewRows(before, after, esc, trail = []) {
  if (deepEqual(before, after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    const left = Array.isArray(before) ? before : [], right = Array.isArray(after) ? after : [];
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => contentPreviewRows(left[index], right[index], esc, [...trail, `Элемент ${index + 1}`])).flat();
  }
  const beforeObject = before && typeof before === "object", afterObject = after && typeof after === "object";
  if (beforeObject || afterObject) {
    const left = beforeObject ? before : {}, right = afterObject ? after : {};
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => contentPreviewRows(left[key], right[key], esc, [...trail, fieldLabel(key)]));
  }
  const label = trail.length ? trail.join(" · ") : "Содержимое";
  return [`<div class="change-row"><strong>${esc(label)}</strong><span>${display(before, esc)}</span><span>${display(after, esc)}</span></div>`];
}

function preview(before, after, esc) {
  const rows = [];
  for (const [key, label] of [["enabled", "Видимость"], ["sort_order", "Порядок"], ["status", "Статус"]]) {
    if (!deepEqual(before[key], after[key])) rows.push(`<div class="change-row"><strong>${label}</strong><span>${key === "status" ? statusLabel(before[key]) : display(before[key], esc)}</span><span>${key === "status" ? statusLabel(after[key]) : display(after[key], esc)}</span></div>`);
  }
  rows.push(...contentPreviewRows(before.content, after.content, esc));
  return rows.length ? `<div class="change-list"><div class="change-row change-head"><strong>Поле</strong><span>Было</span><span>Станет</span></div>${rows.join("")}</div>` : '<p class="notice">Изменений нет.</p>';
}

export function openHomepageEditor(section, context) {
  const { api, confirmAction, esc, friendly, goHomepage, message, rev, view, writesEnabled } = context;
  const original = clone(section); const content = clone(section.content ?? {});
  view(`Главная · ${sectionLabel(section.key)}`, `<form id="home" class="panel form"><p id="home-error" class="error" hidden></p><label class="check"><input name="enabled" type="checkbox" ${section.enabled ? "checked" : ""}>Показывать блок</label><div class="grid"><label>Порядок<input name="sort_order" type="number" min="0" max="1000" value="${Number(section.sort_order ?? 0)}"></label><label>Статус<select name="status"><option value="draft" ${section.status === "draft" ? "selected" : ""}>Черновик</option><option value="published" ${section.status === "published" ? "selected" : ""}>Опубликован</option></select></label></div><fieldset><legend>${sectionLabel(section.key)}</legend><div class="grid homepage-content">${contentFields(content, esc)}</div></fieldset><div class="actions end"><button type="button" id="home-back" class="secondary">Отмена</button><button type="button" id="home-preview" class="secondary">Предпросмотр</button><button id="home-save" data-write>Сохранить</button></div></form>`);
  const form = document.querySelector("#home"), error = document.querySelector("#home-error");
  const collect = () => {
    const nextContent = clone(content);
    form.querySelectorAll("[data-content-key]").forEach(input => { const key = input.dataset.contentKey; nextContent[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value; });
    form.querySelectorAll("[data-content-list]").forEach(list => { const key = list.dataset.contentList; const current = Array.isArray(nextContent[key]) ? nextContent[key] : []; list.querySelectorAll("[data-item-index]").forEach(row => { const index = Number(row.dataset.itemIndex); const item = { ...(current[index] ?? {}) }; row.querySelectorAll("[data-item-key]").forEach(input => { const childKey = input.dataset.itemKey; item[childKey] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value; }); current[index] = item; }); nextContent[key] = current; });
    return { key: section.key, enabled: new FormData(form).has("enabled"), sort_order: Number(new FormData(form).get("sort_order")), status: String(new FormData(form).get("status")), content: nextContent };
  };
  const showError = reason => { error.textContent = friendly(reason); error.hidden = false; };
  document.querySelector("#home-back").onclick = goHomepage;
  document.querySelector("#home-preview").onclick = async () => { try { await confirmAction("Предпросмотр блока", preview(original, collect(), esc), async () => {}); } catch (reason) { showError(reason); } };
  form.onsubmit = async event => { event.preventDefault(); if (!writesEnabled) return showError(new Error("Изменения временно отключены")); const after = collect(); if (deepEqual(original, after)) return message("Изменений нет"); const button = document.querySelector("#home-save"); button.disabled = true; try { const saved = await confirmAction("Сохранить блок?", preview(original, after, esc), () => api(`/homepage/${section.key}`, { method: "PUT", headers: { "If-Match": rev("/homepage") }, body: JSON.stringify({ enabled: after.enabled, sort_order: after.sort_order, status: after.status, content: after.content }) })); if (saved) { message("Блок сохранён"); goHomepage(); } } catch (reason) { showError(reason); } finally { button.disabled = !writesEnabled; } };
}
