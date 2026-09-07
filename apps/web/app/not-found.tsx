import Link from "next/link";

export default function NotFound(){return <main className="wrap empty"><p className="eyebrow">404</p><h1>Такой страницы нет</h1><p className="muted">Возможно, модель уже закончилась или ссылка устарела.</p><Link className="btn" href="/catalog">Вернуться в каталог</Link></main>}
