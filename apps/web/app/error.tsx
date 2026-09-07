"use client";

import Link from "next/link";

export default function ErrorPage({reset}:{reset:()=>void}){return <main className="wrap empty"><p className="eyebrow">Что-то пошло не так</p><h1>Не удалось открыть страницу</h1><p className="muted">Попробуйте ещё раз или вернитесь в каталог.</p><div className="error-actions"><button className="btn" onClick={reset}>Попробовать снова</button><Link className="btn" href="/catalog">В каталог</Link></div></main>}
