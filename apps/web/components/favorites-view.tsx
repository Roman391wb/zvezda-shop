"use client";

import {useEffect,useState} from "react";
import Link from "next/link";

import {ProductCard} from "@/components/product-card";
import {getCatalog} from "@/lib/api";
import {Product} from "@/lib/types";
import {useStore} from "@/components/store-provider";

export function FavoritesView(){const store=useStore(),[products,setProducts]=useState<Product[]>([]),[loading,setLoading]=useState(true),[fallback,setFallback]=useState(false);useEffect(()=>{let active=true;getCatalog({limit:48}).then(result=>{if(active){setProducts(result.data.items);setFallback(result.isFallback);setLoading(false)}});return()=>{active=false}},[]);const favorites=products.filter(product=>store.favorites.includes(product.slug));return <section className="catalog-head"><div className="eyebrow">Сохранённые модели</div><h1>Избранное</h1>{loading?<div className="empty"><p>Загружаем сохранённые модели…</p></div>:favorites.length?<>{fallback&&<p className="notice">Показаны данные из локального демо-режима.</p>}<div className="product-grid">{favorites.map(product=><ProductCard key={product.slug} product={product}/>)}</div></>:<div className="empty"><h2>Здесь пока тихо</h2><p className="muted">Сохраняйте понравившиеся модели, чтобы вернуться к ним позже.</p><Link className="btn" href="/catalog">Открыть каталог</Link></div>}</section>}
