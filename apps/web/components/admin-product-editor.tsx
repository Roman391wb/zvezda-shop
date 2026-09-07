"use client";

import { ChangeEvent, FormEvent, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { adminApi, adminMediaUrl } from "@/lib/admin-api";

type Taxonomy = { id: string; name: string; slug: string; is_active: boolean };
type Variant = { id?: string; sku: string; size: string; color?: string; stock_quantity: number; is_active: boolean };
type Attribute = { name: string; value: string };
type Media = { id: string; url: string; type: string; sort_order: number; is_primary: boolean; is_secondary: boolean; variant_id?: string | null };
type Product = {
  id: string; name: string; slug: string; short_description: string; description: string;
  category_id: string; collection_ids: string[]; price: number; compare_at_price: number | null;
  status: "draft" | "published" | "hidden" | "out_of_stock"; is_featured: boolean; is_new: boolean;
  variants: Variant[]; attributes: Attribute[]; media: Media[];
};
type InventoryMovement = { id: string; variant_id: string; delta: number; balance_after: number; reason: string; note: string | null; actor: string; created_at: string };

const blank = (): Product => ({
  id: "", name: "", slug: "", short_description: "", description: "", category_id: "", collection_ids: [],
  price: 0, compare_at_price: null, status: "draft", is_featured: false, is_new: false,
  variants: [{ sku: "", size: "", color: "", stock_quantity: 0, is_active: true }], attributes: [], media: [],
});
const translit: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const slugify = (value: string) => value.toLowerCase().split("").map((char) => translit[char] ?? char).join("").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function AdminProductEditor({ productId }: { productId?: string }) {
  const [product, setProduct] = useState<Product>(blank);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [collections, setCollections] = useState<Taxonomy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [slugManual, setSlugManual] = useState(Boolean(productId));
  const activeId = productId || product.id;
  const editing = Boolean(activeId);

  const load = async (id = activeId) => {
    try {
      const [cats, cols, current] = await Promise.all([
        adminApi<Taxonomy[]>("/categories"),
        adminApi<Taxonomy[]>("/collections"),
        id ? adminApi<Product>(`/products/${id}`) : Promise.resolve(blank()),
      ]);
      setCategories(cats); setCollections(cols);
      setProduct({ ...current, status: current.status === "out_of_stock" ? "published" : current.status });
      setSlugManual(Boolean(id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить форму");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(productId); }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Product>(key: K, value: Product[K]) => setProduct((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try {
      const body = { ...product, compare_at_price: product.compare_at_price || null, variants: product.variants.filter((item) => item.size.trim()), attributes: product.attributes.filter((item) => item.name.trim() && item.value.trim()) };
      const saved = await adminApi<Product>(editing ? `/products/${activeId}` : "/products", { method: editing ? "PUT" : "POST", body: JSON.stringify(body) });
      setProduct(saved); setSuccess(editing ? "Изменения сохранены" : "Товар создан. Теперь можно загрузить изображения.");
      if (!editing) window.history.replaceState(null, "", `/admin/products/${saved.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить товар"); }
    finally { setSaving(false); }
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || !product.id) return;
    setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.append("file", file);
        await adminApi(`/products/${product.id}/media`, { method: "POST", body: form });
      }
      await load(product.id); setSuccess("Изображения загружены"); event.target.value = "";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить изображение"); }
  };
  const updateMedia = async (mediaId: string, body: object) => {
    if (!product.id) return;
    try { await adminApi(`/products/${product.id}/media/${mediaId}`, { method: "PATCH", body: JSON.stringify(body) }); await load(product.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить изображение"); }
  };
  const removeMedia = async (mediaId: string) => {
    if (!product.id || !window.confirm("Удалить изображение?")) return;
    try { await adminApi(`/products/${product.id}/media/${mediaId}`, { method: "DELETE" }); await load(product.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить изображение"); }
  };
  if (loading) return <main className="admin-shell"><p>Загружаем форму…</p></main>;

  return <main className="admin-shell">
    <header className="admin-header"><div><p className="eyebrow">Зиярат · admin</p><h1>{editing ? "Редактирование товара" : "Новый товар"}</h1></div><Link className="btn" href="/admin">Назад к каталогу</Link></header>
    <form className="admin-form" onSubmit={submit}>
      {error && <p className="admin-error" role="alert">{error}</p>}{success && <p className="admin-success">{success}</p>}
      <div className="admin-form-grid">
        <label>Название<input value={product.name} onChange={(event) => { set("name", event.target.value); if (!slugManual) set("slug", slugify(event.target.value)); }} required /></label>
        <label>Slug<input value={product.slug} onChange={(event) => { setSlugManual(true); set("slug", event.target.value); }} pattern="[a-z0-9-]+" required /></label>
        <label>Категория<select value={product.category_id} onChange={(event) => set("category_id", event.target.value)} required><option value="">Выберите категорию</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}{!item.is_active ? " · скрыта" : ""}</option>)}</select></label>
        <label>Статус<select value={product.status} onChange={(event) => set("status", event.target.value as Product["status"])}><option value="draft">Черновик</option><option value="published">Опубликовать</option><option value="hidden">Скрыть</option></select></label>
        <label>Цена, ₽<input type="number" min="1" value={product.price || ""} onChange={(event) => set("price", Number(event.target.value))} required /></label>
        <label>Старая цена, ₽<input type="number" min="1" value={product.compare_at_price || ""} onChange={(event) => set("compare_at_price", event.target.value ? Number(event.target.value) : null)} /></label>
      </div>
      <label>Краткое описание<input value={product.short_description} onChange={(event) => set("short_description", event.target.value)} required /></label>
      <label>Полное описание<textarea value={product.description} onChange={(event) => set("description", event.target.value)} required /></label>
      <fieldset><legend>Витрины</legend>{collections.map((item) => <label className="check" key={item.id}><input type="checkbox" checked={product.collection_ids.includes(item.id)} onChange={(event) => set("collection_ids", event.target.checked ? [...product.collection_ids, item.id] : product.collection_ids.filter((id) => id !== item.id))} />{item.name}</label>)}<label className="check"><input type="checkbox" checked={product.is_new} onChange={(event) => set("is_new", event.target.checked)} />Новинка</label><label className="check"><input type="checkbox" checked={product.is_featured} onChange={(event) => set("is_featured", event.target.checked)} />Популярное</label></fieldset>
      <EditorList title="Варианты и остатки" add="Добавить размер" items={product.variants} onAdd={() => set("variants", [...product.variants, { sku: "", size: "", color: "", stock_quantity: 0, is_active: true }])} render={(item, index) => <div className="admin-inline variant-inline" key={index}><input placeholder="Размер, например 44" value={item.size} onChange={(event) => set("variants", product.variants.map((variant, current) => current === index ? { ...variant, size: event.target.value } : variant))} /><input placeholder="Цвет" value={item.color||""} onChange={(event) => set("variants", product.variants.map((variant, current) => current === index ? { ...variant, color: event.target.value } : variant))} /><input placeholder="SKU (необязательно)" value={item.sku} onChange={(event) => set("variants", product.variants.map((variant, current) => current === index ? { ...variant, sku: event.target.value } : variant))} /><input aria-label="Остаток" title={item.id?"Для сохранённого варианта используйте корректировку ниже":"Начальный остаток"} type="number" min="0" value={item.stock_quantity} readOnly={Boolean(item.id)} onChange={(event) => set("variants", product.variants.map((variant, current) => current === index ? { ...variant, stock_quantity: Number(event.target.value) } : variant))} /><label className="check"><input type="checkbox" checked={item.is_active} onChange={(event) => set("variants", product.variants.map((variant, current) => current === index ? { ...variant, is_active: event.target.checked } : variant))} />Активен</label><button type="button" className="btn danger" onClick={() => set("variants", product.variants.filter((_, current) => current !== index))}>×</button></div>} />
      {product.id && <InventoryPanel product={product} onApplied={() => load(product.id)} />}
      <EditorList title="Характеристики" add="Добавить характеристику" items={product.attributes} onAdd={() => set("attributes", [...product.attributes, { name: "", value: "" }])} render={(item, index) => <div className="admin-inline" key={index}><input placeholder="Название" value={item.name} onChange={(event) => set("attributes", product.attributes.map((attribute, current) => current === index ? { ...attribute, name: event.target.value } : attribute))} /><input placeholder="Значение" value={item.value} onChange={(event) => set("attributes", product.attributes.map((attribute, current) => current === index ? { ...attribute, value: event.target.value } : attribute))} /><button type="button" className="btn danger" onClick={() => set("attributes", product.attributes.filter((_, current) => current !== index))}>×</button></div>} />
      <section className="admin-images"><h2>Медиа-галерея</h2>{product.id ? <><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple onChange={upload} /><p className="muted">JPEG, PNG, WebP до 10 МБ; MP4/WebM до лимита из переменной окружения.</p><div className="admin-image-grid">{product.media.map((media, index) => <figure key={media.id}>{media.type==="video"?<video src={adminMediaUrl(media.url)} controls/>:<img src={adminMediaUrl(media.url)} alt=""/>}<figcaption><span>{media.is_primary ? "Основное" : <button type="button" className="btn" onClick={() => updateMedia(media.id, { is_primary: true })}>Основное</button>}{media.is_secondary ? " · Hover" : <button type="button" className="btn" onClick={() => updateMedia(media.id, { is_secondary: true })}>Hover</button>}</span><select value={media.variant_id||""} onChange={event=>updateMedia(media.id,{variant_id:event.target.value||null})}><option value="">Все цвета</option>{product.variants.map(variant=><option value={variant.id} key={variant.id}>{variant.color||variant.size}</option>)}</select><span><button type="button" className="btn" disabled={index === 0} onClick={() => updateMedia(media.id, { sort_order: Math.max(0, media.sort_order - 1) })}>Выше</button><button type="button" className="btn danger" onClick={() => removeMedia(media.id)}>Удалить</button></span></figcaption></figure>)}</div></> : <p className="muted">Сначала сохраните товар, затем добавьте фото и видео.</p>}</section>
      <button className="btn dark" disabled={saving} type="submit">{saving ? "Сохраняем…" : "Сохранить товар"}</button>
    </form>
  </main>;
}

function EditorList<T>({ title, add, items, onAdd, render }: { title: string; add: string; items: T[]; onAdd: () => void; render: (item: T, index: number) => ReactNode }) {
  return <section className="admin-editor-list"><div><h2>{title}</h2><button className="btn" type="button" onClick={onAdd}>{add}</button></div>{items.map(render)}</section>;
}

function InventoryPanel({ product, onApplied }: { product: Product; onApplied: () => void }) {
  const [history, setHistory] = useState<InventoryMovement[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { delta: string; reason: string; note: string }>>({});
  const [error, setError] = useState("");
  const loadHistory = async () => {
    try { setHistory(await adminApi<InventoryMovement[]>(`/products/${product.id}/inventory`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю остатков"); }
  };
  useEffect(() => { loadHistory(); }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (variantId: string, key: "delta" | "reason" | "note", value: string) => setDrafts((current) => ({ ...current, [variantId]: { delta: current[variantId]?.delta || "", reason: current[variantId]?.reason || "manual_adjustment", note: current[variantId]?.note || "", [key]: value } }));
  const apply = async (variant: Variant) => {
    if (!variant.id) return;
    const draft = drafts[variant.id] || { delta: "", reason: "manual_adjustment", note: "" };
    setError("");
    try {
      await adminApi(`/variants/${variant.id}/inventory`, { method: "POST", body: JSON.stringify({ delta: Number(draft.delta), reason: draft.reason, note: draft.note }) });
      setDrafts((current) => ({ ...current, [variant.id!]: { delta: "", reason: "manual_adjustment", note: "" } }));
      await loadHistory(); onApplied();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить остаток"); }
  };
  return <section className="admin-editor-list inventory-panel"><div><h2>Корректировка остатков</h2><button type="button" className="btn" onClick={loadHistory}>Обновить историю</button></div>{error && <p className="admin-error" role="alert">{error}</p>}<p className="muted">Изменения фиксируются отдельным движением и не могут привести к отрицательному остатку.</p>{product.variants.map((variant) => { const draft = variant.id ? drafts[variant.id] : undefined; return <div className="inventory-adjustment" key={variant.id || `${variant.sku}-${variant.size}`}><strong>{variant.size || "Размер не указан"}{variant.color ? ` · ${variant.color}` : ""}</strong><span>Сейчас: {variant.stock_quantity}</span>{variant.id ? <><input aria-label={`Изменение остатка ${variant.sku}`} type="number" inputMode="numeric" placeholder="+ / −" value={draft?.delta || ""} onChange={(event) => change(variant.id!, "delta", event.target.value)} /><select aria-label={`Причина для ${variant.sku}`} value={draft?.reason || "manual_adjustment"} onChange={(event) => change(variant.id!, "reason", event.target.value)}><option value="manual_adjustment">Ручная корректировка</option><option value="correction">Инвентаризация</option><option value="initial">Начальный остаток</option><option value="other">Другое</option></select><input aria-label={`Комментарий для ${variant.sku}`} placeholder="Комментарий" value={draft?.note || ""} onChange={(event) => change(variant.id!, "note", event.target.value)} /><button type="button" className="btn" onClick={() => apply(variant)}>Применить</button></> : <em>Сначала сохраните новый вариант.</em>}</div>; })}<div className="inventory-history"><h3>История движений</h3>{history.length ? <div className="inventory-table">{history.map((row) => <div key={row.id}><span>{row.delta > 0 ? "+" : ""}{row.delta} → {row.balance_after}</span><span>{row.reason}</span><span>{row.actor}</span><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString("ru-RU")}</time>{row.note && <small>{row.note}</small>}</div>)}</div> : <p className="muted">Движений пока нет.</p>}</div></section>;
}
