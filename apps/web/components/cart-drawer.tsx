"use client";

import Image from "next/image";
import {useState} from "react";
import {X} from "@phosphor-icons/react";
import {rub} from "@/lib/api";
import {useStore} from "./store-provider";

export function CartDrawer(){
  const store=useStore(),[error,setError]=useState("");
  const total=store.cart.reduce((sum,item)=>sum+item.product.price*item.quantity,0);
  const checkout=()=>{
    setError("");
    const number=(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER||process.env.NEXT_PUBLIC_STORE_WHATSAPP_NUMBER||"").replace(/\D/g,"");
    if(!number){setError("WhatsApp магазина пока не настроен. Укажите NEXT_PUBLIC_WHATSAPP_NUMBER перед static deployment.");return}
    const lines=store.cart.map((item,index)=>{
      const options=Object.entries(item.options).filter(([,value])=>value).map(([key,value])=>`${key==="size"?"Размер":key==="color"?"Цвет":key}: ${value}`).join("\n");
      return `${index+1}. ${item.product.name}\n${options}\nКоличество: ${item.quantity}\nЦена: ${rub(item.product.price*item.quantity)}`;
    }).join("\n\n");
    const url=`https://wa.me/${number}?text=${encodeURIComponent(`Здравствуйте! Хочу оформить заказ.\n\n${lines}\n\nИтого: ${rub(total)}\n\nПодскажите, пожалуйста, актуально ли наличие?`)}`;
    window.location.assign(url);
    store.clear();
    store.setCartOpen(false);
  };
  return <div className="overlay" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&store.setCartOpen(false)}><aside className="drawer" role="dialog" aria-modal="true" aria-label="Корзина"><div className="drawer-head"><span className="eyebrow">Ваш выбор</span><button className="icon-btn" onClick={()=>store.setCartOpen(false)} aria-label="Закрыть"><X size={24}/></button></div><h2>Корзина</h2>{!store.cart.length?<div className="cart-empty"><p>Корзина пока пуста</p><button className="btn" onClick={()=>store.setCartOpen(false)}>Перейти в каталог</button></div>:<>{store.cart.map(item=>{const image=item.product.media.find(media=>media.is_primary)||item.product.media[0];return <div className="cart-line" key={item.variantId}>{image?.type!=="video"?<Image src={image?.url||"/images/dress-studio.jpg"} alt="" width={88} height={112}/>:<div className="image-placeholder"/>}<div><strong>{item.product.name}</strong><div className="muted">{Object.values(item.options).filter(Boolean).join(" · ")}</div><div className="muted">{rub(item.product.price)}</div><div className="qty"><button aria-label="Уменьшить количество" onClick={()=>store.quantity(item.variantId,item.quantity-1)}>−</button>{item.quantity}<button aria-label="Увеличить количество" onClick={()=>store.quantity(item.variantId,item.quantity+1)}>+</button></div></div><button className="icon-btn" onClick={()=>store.remove(item.variantId)} aria-label="Удалить"><X/></button></div>})}<div className="total"><span>Итого</span><span>{rub(total)}</span></div>{error&&<p className="admin-error" role="alert">{error}</p>}<div className="admin-row-actions"><button className="btn" onClick={store.clear}>Очистить корзину</button><button className="btn dark" onClick={checkout}>Оформить в WhatsApp</button></div><p className="muted checkout-note">Наличие, доставка и оплата подтверждаются менеджером в WhatsApp. Сайт не сохраняет ваши персональные данные и заказы.</p></>}</aside></div>;
}
