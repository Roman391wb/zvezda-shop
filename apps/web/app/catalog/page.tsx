import type {Metadata} from "next";

import {StaticCatalogView} from "@/components/static-catalog-view";
import {getCategories,getProducts} from "@/lib/api";

export const metadata:Metadata={title:"Каталог"};
export default async function CatalogPage(){
  const [products,categories]=await Promise.all([getProducts(),getCategories()]);
  return <main className="wrap"><StaticCatalogView products={products} categories={categories.data}/></main>
}
