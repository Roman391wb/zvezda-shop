import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"../../..");
const source=JSON.parse(readFileSync(resolve(root,"apps/web/data/storefront.json"),"utf8"));
const content=resolve(root,"content");
mkdirSync(content,{recursive:true});

const write=(name,value)=>writeFileSync(resolve(content,name),`${JSON.stringify(value,null,2)}\n`);
write("products.json",{products:source.products.map((product,index)=>({...product,sort_order:product.sort_order??index}))});
write("categories.json",{categories:source.categories.map((category,index)=>({...category,sort_order:category.sort_order??index,is_visible:category.is_visible??true}))});
write("collections.json",{collections:source.collections.map((collection,index)=>({...collection,sort_order:collection.sort_order??index,is_visible:collection.is_visible??true}))});
write("homepage.json",{sections:source.homepage});
const envValue=(key)=>{
  if(process.env[key]) return process.env[key];
  const envFile=resolve(root,".env");
  if(!existsSync(envFile)) return "";
  const line=readFileSync(envFile,"utf8").split(/\r?\n/).find(value=>value.startsWith(`${key}=`));
  return line?.slice(key.length+1).trim().replace(/^['"]|['"]$/g,"")||"";
};
const whatsapp=envValue("NEXT_PUBLIC_WHATSAPP_NUMBER")||envValue("NEXT_PUBLIC_STORE_WHATSAPP_NUMBER");
write("settings.json",{settings:{
  store_name:"",
  whatsapp,
  telegram:"",
  phone:"",
  email:"",
  delivery:"",
  returns:"",
  footer:"",
  seo_title:"",
  seo_description:"",
  ...source.settings,
}});
console.log(`Git content created: ${source.products.length} products, ${source.categories.length} categories, ${source.collections.length} collections.`);
