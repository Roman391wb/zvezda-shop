// Public storefront data is exported once from PostgreSQL into this JSON file.
// It is bundled at build time; these functions never fetch FastAPI at runtime.
import source from "@/data/storefront.json";
import {Category, Collection, HomepageSection, Product, ProductList} from "./types";

export type CatalogFilters={q?:string;category?:string;collection?:string;sort?:"recommended"|"newest"|"price-asc"|"price-desc";min_price?:number;max_price?:number;size?:string;color?:string;in_stock?:boolean;featured?:boolean;is_new?:boolean;sale?:boolean;limit?:number;offset?:number};
export type ApiResult<T>={data:T;isFallback:boolean};
export type StoreSettings=Record<string,string>;

const products=source.products as Product[];
const categories=source.categories as Category[];
const collections=source.collections as Collection[];
const homepage=source.homepage as HomepageSection[];
const settings=source.settings as StoreSettings;

function catalog(filters:CatalogFilters):ProductList{let items=[...products];const q=filters.q?.trim().toLocaleLowerCase();if(q)items=items.filter(product=>(product.name+product.category+product.short_description).toLocaleLowerCase().includes(q));if(filters.category)items=filters.category==="sale"?items.filter(product=>Boolean(product.compare_at_price)):items.filter(product=>(product as Product&{category_slug?:string}).category_slug===filters.category||product.category===filters.category);if(filters.collection)items=items.filter(product=>product.collections.includes(filters.collection!));if(filters.featured)items=items.filter(product=>product.is_featured);if(filters.is_new)items=items.filter(product=>product.is_new);if(filters.sale)items=items.filter(product=>Boolean(product.compare_at_price));if(filters.min_price!==undefined)items=items.filter(product=>product.price>=filters.min_price!);if(filters.max_price!==undefined)items=items.filter(product=>product.price<=filters.max_price!);if(filters.size)items=items.filter(product=>product.variants?.some(variant=>variant.options.size===filters.size));if(filters.color)items=items.filter(product=>product.variants?.some(variant=>variant.options.color===filters.color));if(filters.in_stock)items=items.filter(product=>product.variants?.some(variant=>variant.is_active&&variant.stock_quantity>0));if(filters.sort==="newest")items.reverse();if(filters.sort==="price-asc")items.sort((a,b)=>a.price-b.price);if(filters.sort==="price-desc")items.sort((a,b)=>b.price-a.price);const offset=filters.offset||0,limit=filters.limit||12;return {items:items.slice(offset,offset+limit),total:items.length,limit,offset}}

export async function getCatalog(filters:CatalogFilters={}):Promise<ApiResult<ProductList>>{return {data:catalog(filters),isFallback:false}}
export async function getCategories():Promise<ApiResult<Category[]>>{return {data:categories,isFallback:false}}
export async function getCollections():Promise<ApiResult<Collection[]>>{return {data:collections,isFallback:false}}
export async function getProducts(filters:CatalogFilters={}):Promise<Product[]>{return catalog({...filters,limit:filters.limit||48}).items}
export async function getProduct(slug:string):Promise<Product|undefined>{return products.find(product=>product.slug===slug)}
export async function getHomepage():Promise<HomepageSection[]>{return homepage}
export async function getStoreSettings():Promise<StoreSettings>{return settings}
export const rub=(value:number)=>new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",maximumFractionDigits:0}).format(value/100);
