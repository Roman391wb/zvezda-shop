import {
  changedProductPayload,
  formatMoney,
  kopecksToRublesInput,
  mediaPreviewUrl,
  mergeAttribute,
  mergeVariant,
  parseRubles,
  statusLabel,
  usageLabels
} from "./admin-domain.mjs?v=admin-ux-1";

const clone = value => JSON.parse(JSON.stringify(value));
const filename = url => String(url ?? "").split("/").at(-1) || "Изображение";

function statusOptions(selected) {
  return ["draft", "published", "hidden", "out_of_stock"].map(value => `<option value="${value}" ${value === selected ? "selected" : ""}>${statusLabel(value)}</option>`).join("");
}

function previewImage(apiBase, url, alt, esc) {
  if (!url) return '<span class="image-empty">Нет фото</span>';
  return `<img src="${esc(mediaPreviewUrl(apiBase, url))}" alt="${esc(alt || filename(url))}" data-preview-image><span class="image-error" hidden>Фото недоступно</span>`;
}

function changeRows(before, after, esc, apiBase) {
  const definitions = [
    ["name", "Название"], ["slug", "Адрес страницы"], ["article", "Артикул товара"],
    ["category_slug", "Категория"], ["price", "Цена"], ["compare_at_price", "Старая цена"],
    ["status", "Статус"], ["cardImage", "Изображение карточки"], ["short_description", "Краткое описание"],
    ["description", "Описание"], ["collections", "Коллекции"], ["variants", "Варианты"],
    ["attributes", "Характеристики"], ["media", "Фотографии"], ["is_featured", "Популярный товар"], ["is_new", "Новинка"]
  ];
  const display = (key, value) => {
    if (key === "price" || key === "compare_at_price") return value == null ? "—" : formatMoney(value);
    if (key === "status") return statusLabel(value);
    if (key === "variants") return `<ul class="change-details">${(Array.isArray(value) ? value : []).map(item => `<li>${esc(item.sku || "Без артикула")} · ${esc(item.options?.color || "цвет не указан")} · размер ${esc(item.options?.size || "—")} · остаток ${Number(item.stock_quantity ?? 0)} · ${item.is_active === false ? "неактивен" : "активен"}</li>`).join("") || "<li>Нет вариантов</li>"}</ul>`;
    if (key === "attributes") return `<ul class="change-details">${(Array.isArray(value) ? value : []).map(item => `<li>${esc(item.name || "Без названия")}: ${esc(item.value || "—")}</li>`).join("") || "<li>Нет характеристик</li>"}</ul>`;
    if (key === "media") return `<ul class="change-details">${(Array.isArray(value) ? value : []).map(item => `<li>${esc(filename(item.url))}${item.alt_text ? ` · ${esc(item.alt_text)}` : ""}</li>`).join("") || "<li>Нет фотографий</li>"}</ul>`;
    if (key === "collections") return Array.isArray(value) && value.length ? value.join(", ") : "—";
    if (key === "is_featured" || key === "is_new") return value ? "Да" : "Нет";
    if (key === "cardImage") return value ? `<span class="change-image">${previewImage(apiBase, value, "", esc)}<small>${esc(filename(value))}</small></span>` : "Нет фото";
    return esc(value ?? "—");
  };
  const rows = definitions.filter(([key]) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])).map(([key, label]) => `<div class="change-row"><strong>${label}</strong><span>${display(key, before?.[key])}</span><span>${display(key, after?.[key])}</span></div>`);
  return rows.length ? `<div class="change-list"><div class="change-row change-head"><strong>Поле</strong><span>Было</span><span>Станет</span></div>${rows.join("")}</div>` : '<p class="notice">Изменений нет.</p>';
}

export async function openProductEditor(id, context) {
  const { api, apiBase, confirmAction, esc, friendly, goProducts, loading, message, rev, view, writesEnabled } = context;
  loading(id ? "Редактирование товара" : "Новый товар");
  const workspace = await api(`/workspace${id ? `?id=${encodeURIComponent(id)}` : ""}`);
  const { categories, collections, media: uploaded } = workspace;
  const product = id ? workspace.product : { name: "", slug: "", article: null, short_description: "", description: "", category_slug: "", collections: [], status: "draft", variants: [], media: [], attributes: [], compare_at_price: null, is_featured: false, is_new: false };
  const original = id ? clone(product) : null;
  let variants = clone(product.variants ?? []);
  let attributes = clone(product.attributes ?? []);
  let media = clone(product.media ?? []);
  let mediaRows = clone(uploaded);
  let cardImage = product.cardImage ?? null;
  let variantsDirty = false, attributesDirty = false, mediaDirty = false, cardDirty = false;
  let pickerMode = "media";
  let objectUrl = null;

  const allChoices = () => {
    const byUrl = new Map();
    for (const item of [...mediaRows, ...media]) if (item?.url && !byUrl.has(item.url)) byUrl.set(item.url, item);
    return [...byUrl.values()];
  };

  view(id ? "Редактирование товара" : "Новый товар", `<form id="editor" class="panel form product-editor" novalidate>
    <p id="editor-error" class="error" hidden></p>
    <div class="grid">
      <label>Название<input name="name" value="${esc(product.name)}" required minlength="2"></label>
      <label>Адрес страницы<input name="slug" value="${esc(product.slug)}" required pattern="[a-z0-9][a-z0-9-]*"></label>
      <label>Артикул товара<input name="article" value="${esc(product.article ?? "")}" placeholder="Не задан"></label>
      <label>Категория<select name="category_slug" required><option value="">Выберите категорию</option>${categories.map(category => `<option value="${esc(category.slug)}" ${category.slug === product.category_slug ? "selected" : ""}>${esc(category.name)}</option>`).join("")}</select></label>
      <label>Цена, ₽<input name="price" inputmode="decimal" value="${product.price ? esc(kopecksToRublesInput(product.price)) : ""}" placeholder="3500 или 3500,50" required><small id="price-preview"></small></label>
      <label>Старая цена, ₽<input name="compare_at_price" inputmode="decimal" value="${product.compare_at_price ? esc(kopecksToRublesInput(product.compare_at_price)) : ""}" placeholder="Необязательно"></label>
      <label>Статус<select name="status">${statusOptions(product.status)}</select></label>
    </div>
    <div class="checks"><label><input type="checkbox" name="is_featured" ${product.is_featured ? "checked" : ""}>Популярный товар</label><label><input type="checkbox" name="is_new" ${product.is_new ? "checked" : ""}>Новинка</label></div>
    <label>Краткое описание<textarea name="short_description" required minlength="2">${esc(product.short_description)}</textarea></label>
    <label>Описание<textarea name="description" class="large" required minlength="2">${esc(product.description)}</textarea></label>
    <fieldset><legend>Коллекции</legend><div class="checks">${collections.map(collection => `<label><input type="checkbox" name="collections" value="${esc(collection.slug)}" ${(product.collections ?? []).includes(collection.slug) ? "checked" : ""}>${esc(collection.name)}</label>`).join("") || "Нет доступных коллекций"}</div></fieldset>
    <fieldset><legend>Изображение карточки</legend><div id="card-image" class="card-image-choice"></div><button type="button" id="choose-card" class="secondary">Выбрать изображение</button></fieldset>
    <fieldset><legend>Фотографии товара</legend><div id="product-media" class="product-media"></div><button type="button" id="add-photo" class="secondary">Добавить фото</button></fieldset>
    <fieldset><legend>Варианты товара</legend><div id="variants" class="editor-list"></div><button type="button" id="add-variant" class="secondary">Добавить вариант</button></fieldset>
    <fieldset><legend>Характеристики</legend><div id="attributes" class="editor-list"></div><button type="button" id="add-attribute" class="secondary">Добавить характеристику</button></fieldset>
    <div class="actions end"><button type="button" id="back" class="secondary">Отмена</button><button type="button" id="preview" class="secondary">Предпросмотр</button><button id="save-product" data-write>Сохранить</button></div>
  </form>
  <dialog id="media-picker"><div class="dialog-body"><div class="picker-head"><div><p class="kicker">МЕДИАТЕКА</p><h2 id="picker-title">Выберите изображение</h2></div><button type="button" id="close-picker" class="secondary">Закрыть</button></div><label class="upload-box">Добавить новый файл<input id="picker-file" type="file" accept="image/jpeg,image/png,image/webp" ${writesEnabled ? "" : "disabled"}><img id="local-preview" alt="Локальный предпросмотр" hidden><small id="file-name"></small><button type="button" id="upload-picker" data-write ${writesEnabled ? "" : "disabled"}>Загрузить</button></label><div id="picker-grid" class="media picker-grid"></div></div></dialog>`);

  const form = document.querySelector("#editor");
  const error = document.querySelector("#editor-error");
  const showError = value => { error.textContent = value; error.hidden = false; };
  const clearError = () => { error.hidden = true; error.textContent = ""; };
  const bindImageErrors = root => root.querySelectorAll("[data-preview-image]").forEach(image => { image.addEventListener("error", () => { image.hidden = true; const note = image.nextElementSibling; if (note) note.hidden = false; }); });

  const renderCard = () => {
    const root = document.querySelector("#card-image");
    root.innerHTML = cardImage ? `<div class="selected-card-image">${previewImage(apiBase, cardImage, product.name, esc)}<div><b>${esc(filename(cardImage))}</b><small>Публичный адрес: ${esc(cardImage)}</small><button type="button" id="clear-card" class="danger secondary">Убрать выбор</button></div></div>` : '<span class="image-empty">Изображение карточки не выбрано</span>';
    bindImageErrors(root);
    document.querySelector("#clear-card")?.addEventListener("click", () => { cardImage = null; cardDirty = true; renderCard(); });
  };

  const renderMedia = () => {
    const root = document.querySelector("#product-media");
    root.innerHTML = media.length ? media.map((item, index) => `<article class="product-media-card" data-index="${index}">${previewImage(apiBase, item.url, item.alt_text, esc)}<label>Подпись<input data-media-alt value="${esc(item.alt_text ?? "")}"></label><small>${esc(filename(item.url))}</small><div class="actions"><button type="button" data-primary class="secondary">Сделать изображением карточки</button><button type="button" data-up class="secondary" ${index === 0 ? "disabled" : ""}>Выше</button><button type="button" data-down class="secondary" ${index === media.length - 1 ? "disabled" : ""}>Ниже</button><button type="button" data-remove-media class="danger secondary">Убрать из товара</button></div></article>`).join("") : '<span class="image-empty">У товара пока нет фотографий</span>';
    bindImageErrors(root);
  };

  const renderVariants = () => {
    const root = document.querySelector("#variants");
    root.innerHTML = variants.length ? variants.map((variant, index) => `<article class="variant-card" data-index="${index}"><input type="hidden" data-variant-id value="${esc(variant.id ?? "")}"><label>Артикул варианта<input data-variant-field="sku" value="${esc(variant.sku ?? "")}"></label><label>Цвет<input data-variant-field="color" value="${esc(variant.options?.color ?? "")}"></label><label>Размер<input data-variant-field="size" value="${esc(variant.options?.size ?? "")}" required></label><label>Остаток<input data-variant-field="stock_quantity" type="number" min="0" max="100000" value="${Number(variant.stock_quantity ?? 0)}" required></label><label class="check"><input data-variant-field="is_active" type="checkbox" ${variant.is_active !== false ? "checked" : ""}>Активен</label><button type="button" data-remove-variant class="danger secondary">Удалить вариант</button></article>`).join("") : '<span class="image-empty">Вариантов нет</span>';
  };

  const renderAttributes = () => {
    const root = document.querySelector("#attributes");
    root.innerHTML = attributes.length ? attributes.map((attribute, index) => `<article class="attribute-row" data-index="${index}"><label>Название характеристики<input data-attribute-field="name" value="${esc(attribute.name ?? "")}" required></label><label>Значение<input data-attribute-field="value" value="${esc(attribute.value ?? "")}" required></label><button type="button" data-remove-attribute class="danger secondary">Удалить</button></article>`).join("") : '<span class="image-empty">Характеристик нет</span>';
  };

  const renderPicker = () => {
    const root = document.querySelector("#picker-grid");
    const choices = allChoices();
    root.innerHTML = choices.length ? choices.map(item => `<article><div class="picker-image">${previewImage(apiBase, item.url, filename(item.url), esc)}</div><b>${esc(filename(item.url))}</b><small>${item.references?.length ? `Используется: ${esc(usageLabels(item.references).join(", "))}` : "Доступно для выбора"}</small><button type="button" data-pick="${esc(item.url)}" class="secondary">Выбрать</button></article>`).join("") : '<span class="image-empty">Загруженных изображений нет</span>';
    bindImageErrors(root);
  };

  const openPicker = mode => { pickerMode = mode; document.querySelector("#picker-title").textContent = mode === "card" ? "Изображение карточки" : "Добавить фото товара"; renderPicker(); document.querySelector("#media-picker").showModal(); };
  const closePicker = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; document.querySelector("#picker-file").value = ""; document.querySelector("#local-preview").hidden = true; document.querySelector("#file-name").textContent = ""; document.querySelector("#media-picker").close(); };

  document.querySelector("#variants").addEventListener("input", event => {
    const row = event.target.closest(".variant-card"); if (!row) return; const index = Number(row.dataset.index); const originalVariant = variants[index]; const fields = {
      id: row.querySelector("[data-variant-id]").value || undefined,
      sku: row.querySelector('[data-variant-field="sku"]').value.trim(), color: row.querySelector('[data-variant-field="color"]').value.trim(), size: row.querySelector('[data-variant-field="size"]').value.trim(),
      stock_quantity: Number(row.querySelector('[data-variant-field="stock_quantity"]').value), is_active: row.querySelector('[data-variant-field="is_active"]').checked
    };
    variants[index] = mergeVariant(originalVariant, fields); variantsDirty = true;
  });
  document.querySelector("#variants").addEventListener("click", event => { const button = event.target.closest("[data-remove-variant]"); if (!button) return; const index = Number(button.closest(".variant-card").dataset.index); variants.splice(index, 1); variantsDirty = true; renderVariants(); });
  document.querySelector("#add-variant").onclick = () => { variants.push({ sku: "", options: { size: "", color: "" }, stock_quantity: 0, is_active: true, media: [] }); variantsDirty = true; renderVariants(); };

  document.querySelector("#attributes").addEventListener("input", event => { const row = event.target.closest(".attribute-row"); if (!row) return; const index = Number(row.dataset.index); attributes[index] = mergeAttribute(attributes[index], { name: row.querySelector('[data-attribute-field="name"]').value, value: row.querySelector('[data-attribute-field="value"]').value }); attributesDirty = true; });
  document.querySelector("#attributes").addEventListener("click", event => { const button = event.target.closest("[data-remove-attribute]"); if (!button) return; attributes.splice(Number(button.closest(".attribute-row").dataset.index), 1); attributesDirty = true; renderAttributes(); });
  document.querySelector("#add-attribute").onclick = () => { attributes.push({ name: "", value: "" }); attributesDirty = true; renderAttributes(); };

  document.querySelector("#product-media").addEventListener("input", event => { if (!event.target.matches("[data-media-alt]")) return; const index = Number(event.target.closest(".product-media-card").dataset.index); media[index] = { ...media[index], alt_text: event.target.value }; mediaDirty = true; });
  document.querySelector("#product-media").addEventListener("click", event => {
    const row = event.target.closest(".product-media-card"); if (!row) return; const index = Number(row.dataset.index);
    if (event.target.closest("[data-primary]")) { cardImage = media[index].url; cardDirty = true; renderCard(); }
    if (event.target.closest("[data-remove-media]")) { media.splice(index, 1); mediaDirty = true; renderMedia(); }
    if (event.target.closest("[data-up]") && index > 0) { [media[index - 1], media[index]] = [media[index], media[index - 1]]; mediaDirty = true; renderMedia(); }
    if (event.target.closest("[data-down]") && index < media.length - 1) { [media[index + 1], media[index]] = [media[index], media[index + 1]]; mediaDirty = true; renderMedia(); }
  });

  document.querySelector("#choose-card").onclick = () => openPicker("card");
  document.querySelector("#add-photo").onclick = () => openPicker("media");
  document.querySelector("#close-picker").onclick = closePicker;
  document.querySelector("#picker-grid").addEventListener("click", event => { const button = event.target.closest("[data-pick]"); if (!button) return; const url = button.dataset.pick; if (pickerMode === "card") { cardImage = url; cardDirty = true; renderCard(); } else if (!media.some(item => item.url === url)) { media.push({ id: crypto.randomUUID(), type: "image", url, alt_text: product.name || "", sort_order: media.length, is_primary: media.length === 0, is_secondary: false, variant_id: null }); mediaDirty = true; renderMedia(); } closePicker(); });
  document.querySelector("#picker-file").onchange = event => { const file = event.target.files[0]; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = file ? URL.createObjectURL(file) : null; const image = document.querySelector("#local-preview"); image.src = objectUrl ?? ""; image.hidden = !objectUrl; document.querySelector("#file-name").textContent = file ? `${file.name} · ${Math.ceil(file.size / 1024)} КБ` : ""; };
  document.querySelector("#upload-picker").onclick = async event => {
    if (!writesEnabled) return; const file = document.querySelector("#picker-file").files[0]; if (!file) return showError("Выберите файл изображения");
    const button = event.currentTarget; button.disabled = true; let uploadedItem = null;
    try { const data = new FormData(); data.append("file", file, file.name); await confirmAction("Загрузить изображение?", `<p>${esc(file.name)} · ${Math.ceil(file.size / 1024)} КБ</p>`, async () => { uploadedItem = await api("/media", { method: "POST", headers: { "If-Match": rev("/media") }, body: data }); }); if (uploadedItem) { mediaRows = await api("/media"); renderPicker(); message("Изображение загружено и готово к выбору"); } }
    catch (reason) { showError(friendly(reason)); } finally { button.disabled = false; }
  };

  const collect = () => {
    clearError();
    if (!form.reportValidity()) throw new Error("Проверьте обязательные поля");
    const values = new FormData(form); const price = parseRubles(String(values.get("price") ?? "")); const compareRaw = String(values.get("compare_at_price") ?? "").trim(); const compare = compareRaw ? parseRubles(compareRaw) : null;
    if (compare !== null && compare <= price) throw new Error("Старая цена должна быть больше текущей");
    const next = { name: String(values.get("name")).trim(), slug: String(values.get("slug")).trim(), article: String(values.get("article") ?? "").trim() || null, short_description: String(values.get("short_description")).trim(), description: String(values.get("description")).trim(), category_slug: String(values.get("category_slug")), collections: values.getAll("collections"), price, compare_at_price: compare, status: String(values.get("status")), is_featured: values.has("is_featured"), is_new: values.has("is_new"), cardImage, variants, media: media.map((item, index) => ({ ...item, sort_order: index })), attributes };
    if (original && !Object.hasOwn(original, "cardImage") && !cardDirty) delete next.cardImage;
    if (original && !Object.hasOwn(original, "variants") && !variantsDirty) delete next.variants;
    if (original && !Object.hasOwn(original, "media") && !mediaDirty) delete next.media;
    if (original && !Object.hasOwn(original, "attributes") && !attributesDirty) delete next.attributes;
    return original ? changedProductPayload(original, next) : next;
  };

  const getPreview = async () => { const payload = collect(); if (original && !Object.keys(payload).length) return { before: original, after: original, payload }; if (!id) return { before: null, after: payload, payload }; const preview = await api(`/products/${id}/preview`, { method: "POST", headers: { "If-Match": rev("/products") }, body: JSON.stringify(payload) }); return { ...preview, payload }; };
  const showPreview = async () => { try { const preview = await getPreview(); await confirmAction("Предпросмотр изменений", changeRows(preview.before, preview.after, esc, apiBase), async () => {}); } catch (reason) { showError(friendly(reason)); } };

  document.querySelector('[name="price"]').addEventListener("input", event => { try { document.querySelector("#price-preview").textContent = formatMoney(parseRubles(event.target.value)); event.target.setCustomValidity(""); } catch (reason) { document.querySelector("#price-preview").textContent = reason.message; event.target.setCustomValidity(reason.message); } });
  document.querySelector('[name="price"]').dispatchEvent(new Event("input"));
  document.querySelector("#back").onclick = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); goProducts(); };
  document.querySelector("#preview").onclick = showPreview;
  form.onsubmit = async event => {
    event.preventDefault(); if (!writesEnabled) return showError("Изменения временно отключены"); const button = document.querySelector("#save-product"); button.disabled = true;
    try { const preview = await getPreview(); if (original && !Object.keys(preview.payload).length) { message("Изменений нет"); return; } const saved = await confirmAction(id ? "Сохранить товар?" : "Создать товар?", changeRows(preview.before, preview.after, esc, apiBase), () => api(id ? `/products/${id}` : "/products", { method: id ? "PUT" : "POST", headers: { "If-Match": rev("/products") }, body: JSON.stringify(preview.payload) })); if (saved) { message("Товар сохранён"); goProducts(); } }
    catch (reason) { showError(friendly(reason)); } finally { button.disabled = !writesEnabled; }
  };

  renderCard(); renderMedia(); renderVariants(); renderAttributes();
}
