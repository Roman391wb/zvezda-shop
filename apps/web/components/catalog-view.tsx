"use client";

import {FormEvent,useState} from "react";
import {useRouter} from "next/navigation";

import {ProductCard} from "@/components/product-card";
import {CatalogFilters} from "@/lib/api";
import {Category,ProductList} from "@/lib/types";

type Props={initial:ProductList;categories:Category[];filters:CatalogFilters;isFallback:boolean};
export function CatalogView({initial,categories,filters,isFallback}:Props){
  const router=useRouter();
  const [query,setQuery]=useState(filters.q||"");
  const [min,setMin]=useState(filters.min_price?String(filters.min_price/100):"");
  const [max,setMax]=useState(filters.max_price?String(filters.max_price/100):"");
  const [size,setSize]=useState(filters.size||"");const [color,setColor]=useState(filters.color||"");
  const [filtersOpen,setFiltersOpen]=useState(false);
  const setFilters=(next:CatalogFilters)=>{const params=new URLSearchParams();for(const [key,value] of Object.entries({...filters,...next,offset:next.offset===undefined?0:next.offset})){if(value!==undefined&&value!==false&&value!=="")params.set(key,String(value))}router.push(`/catalog?${params.toString()}`)};
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setFiltersOpen(false);setFilters({q:query,min_price:min?Number(min)*100:undefined,max_price:max?Number(max)*100:undefined,size,color})};
  const page=Math.floor((initial.offset||0)/initial.limit)+1,totalPages=Math.max(1,Math.ceil(initial.total/initial.limit));
  return <section className="catalog-head"><div className="eyebrow">Каталог</div><h1>Найдите своё</h1><p className="muted">Свободные формы, тактильные ткани и детали, которые остаются уместными.</p>{isFallback&&<p className="notice" role="status">Каталог показан из локального демо-режима: подключение к API временно недоступно.</p>}
    {filtersOpen&&<button className="filters-backdrop" aria-label="Закрыть фильтры" onClick={()=>setFiltersOpen(false)}/>}<form className={`filters ${filtersOpen?"filters-open":""}`} onSubmit={submit} role="dialog" aria-modal={filtersOpen} aria-label="Фильтры каталога"><div className="filters-title"><strong>Фильтры</strong><button type="button" aria-label="Закрыть фильтры" onClick={()=>setFiltersOpen(false)}>×</button></div><input aria-label="Поиск по каталогу" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск по каталогу"/><input aria-label="Цена от, ₽" inputMode="numeric" value={min} onChange={e=>setMin(e.target.value)} placeholder="Цена от, ₽"/><input aria-label="Цена до, ₽" inputMode="numeric" value={max} onChange={e=>setMax(e.target.value)} placeholder="Цена до, ₽"/><input aria-label="Размер" value={size} onChange={e=>setSize(e.target.value)} placeholder="Размер"/><input aria-label="Цвет" value={color} onChange={e=>setColor(e.target.value)} placeholder="Цвет"/><button className="btn" type="submit">Показать товары</button></form>
    <div className="catalog-bar"><div className="chips"><button className={`chip ${!filters.category?"active":""}`} onClick={()=>setFilters({category:undefined})}>Все</button><button className={`chip ${filters.category==="sale"?"active":""}`} onClick={()=>setFilters({category:"sale"})}>Распродажа</button>{categories.map(category=><button key={category.slug} className={`chip ${filters.category===category.slug?"active":""}`} onClick={()=>setFilters({category:category.slug})}>{category.name}</button>)}</div><div className="catalog-controls"><button className="mobile-filter-trigger" onClick={()=>setFiltersOpen(true)}>Фильтры</button><label><input type="checkbox" checked={Boolean(filters.in_stock)} onChange={e=>setFilters({in_stock:e.target.checked})}/> В наличии</label><select className="sort" aria-label="Сортировка" value={filters.sort||"recommended"} onChange={e=>setFilters({sort:e.target.value as CatalogFilters["sort"]})}><option value="recommended">Сначала популярное</option><option value="newest">Сначала новинки</option><option value="price-asc">Сначала дешевле</option><option value="price-desc">Сначала дороже</option></select></div></div>
    <p className="muted results-count">{initial.total?`Найдено: ${initial.total}`:"Ничего не найдено"}</p>
    {initial.items.length?<><div className="product-grid">{initial.items.map(product=><ProductCard key={product.slug} product={product}/>)}</div>{totalPages>1&&<nav className="pagination" aria-label="Страницы каталога"><button className="btn" disabled={page===1} onClick={()=>setFilters({offset:Math.max(0,initial.offset-initial.limit)})}>Назад</button><span>{page} / {totalPages}</span><button className="btn" disabled={page===totalPages} onClick={()=>setFilters({offset:initial.offset+initial.limit})}>Далее</button></nav>}</>:<div className="empty"><h2>Ничего не нашли</h2><p className="muted">Измените параметры поиска или вернитесь ко всем моделям.</p><button className="btn" onClick={()=>router.push("/catalog")}>Сбросить фильтры</button></div>}</section>
}
