import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {ProductView} from "@/components/product-view";
import {getProduct,getProducts} from "@/lib/api";

export async function generateStaticParams(){return (await getProducts()).map(product=>({slug:product.slug}))}
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const product=await getProduct((await params).slug);return {title:product?.name||"Товар не найден"}}
export default async function ProductPage({params}:{params:Promise<{slug:string}>}){const product=await getProduct((await params).slug);if(!product)return notFound();return <ProductView product={product}/>}
