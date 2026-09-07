"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, adminMediaUrl } from "@/lib/admin-api";

type Taxonomy = { id: string; name: string; slug: string; description: string | null; media_url: string | null; sort_order: number; is_active: boolean };
type Draft = Omit<Taxonomy, "id">;
const empty = (): Draft => ({ name: "", slug: "", description: "", media_url: "", sort_order: 0, is_active: true });

export function AdminTaxonomyManager() {
  const [kind, setKind] = useState<"categories" | "collections">("categories");
  const [items, setItems] = useState<Taxonomy[]>([]);
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const load = async (target = kind) => {
    try { setItems(await adminApi<Taxonomy[]>(`/${target}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить список"); }
  };
  useEffect(() => { setDraft(empty()); setEditing(null); load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const uploadCover=async(event:ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];if(!file)return;try{const form=new FormData();form.append("file",file);const result=await adminApi<{url:string}>("/media",{method:"POST",body:form});set("media_url",result.url);setSuccess("Обложка загружена") }catch(reason){setError(reason instanceof Error?reason.message:"Не удалось загрузить обложку")}};
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess("");
    try {
      await adminApi(`/${kind}${editing ? `/${editing}` : ""}`, { method: editing ? "PUT" : "POST", body: JSON.stringify({ ...draft, description: draft.description || null, media_url: draft.media_url || null }) });
      setDraft(empty()); setEditing(null); setSuccess(editing ? "Изменения сохранены" : "Сущность добавлена"); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить"); }
  };
  const edit = (item: Taxonomy) => { setEditing(item.id); setDraft({ name: item.name, slug: item.slug, description: item.description || "", media_url: item.media_url || "", sort_order: item.sort_order, is_active: item.is_active }); setSuccess(""); };
  const remove = async (item: Taxonomy) => {
    if (!window.confirm(`Удалить «${item.name}»? Если она связана с товарами, удаление будет заблокировано.`)) return;
    try { await adminApi(`/${kind}/${item.id}`, { method: "DELETE" }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить"); }
  };
  const noun = kind === "categories" ? "категорию" : "коллекцию";
  return <main className="admin-shell">
    <header className="admin-header"><div><p className="eyebrow">Зиярат · admin</p><h1>Категории и коллекции</h1></div><Link className="btn" href="/admin">Назад к каталогу</Link></header>
    <div className="admin-tabs"><button className={kind === "categories" ? "active" : ""} onClick={() => setKind("categories")}>Категории</button><button className={kind === "collections" ? "active" : ""} onClick={() => setKind("collections")}>Коллекции</button></div>
    {error && <p className="admin-error" role="alert">{error}</p>}{success && <p className="admin-success">{success}</p>}
    <section className="admin-panel"><h2>{editing ? `Редактировать ${noun}` : `Новая ${noun}`}</h2><form className="admin-form" onSubmit={submit}><div className="admin-form-grid"><label>Название<input value={draft.name} onChange={(event) => set("name", event.target.value)} required /></label><label>Slug<input value={draft.slug} onChange={(event) => set("slug", event.target.value)} pattern="[a-z0-9-]+" required /></label><label>Порядок<input type="number" min="0" value={draft.sort_order} onChange={(event) => set("sort_order", Number(event.target.value))} /></label><label className="check">Показывать<input type="checkbox" checked={draft.is_active} onChange={(event) => set("is_active", event.target.checked)} /></label></div><label>Описание (необязательно)<textarea value={draft.description || ""} onChange={(event) => set("description", event.target.value)} /></label><label>Обложка категории<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadCover}/></label>{draft.media_url&&<a className="text-link" href={adminMediaUrl(draft.media_url)} target="_blank" rel="noreferrer">Открыть обложку</a>}<div className="admin-row-actions"><button className="btn dark" type="submit">{editing ? "Сохранить" : "Добавить"}</button>{editing && <button className="btn" type="button" onClick={() => { setEditing(null); setDraft(empty()); }}>Отменить</button>}</div></form></section>
    <section className="admin-panel"><h2>Текущий список</h2><div className="admin-product-list">{items.map((item) => <article className="admin-product-row" key={item.id}><div><strong>{item.name}</strong><span>{item.slug} · порядок {item.sort_order} · {item.is_active ? "показывается" : "скрыта"}</span></div><div className="admin-row-actions"><button className="btn" onClick={() => edit(item)}>Изменить</button><button className="btn danger" onClick={() => remove(item)}>Удалить</button></div></article>)}{items.length === 0 && <p className="muted">Пока нет записей.</p>}</div></section>
  </main>;
}
