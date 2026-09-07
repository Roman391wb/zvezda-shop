// Public storefront data is committed to Git and bundled at build time.
// These functions never fetch FastAPI at runtime.
import productsSource from "../../../content/products.json";
import categoriesSource from "../../../content/categories.json";
import collectionsSource from "../../../content/collections.json";
import homepageSource from "../../../content/homepage.json";
import settingsSource from "../../../content/settings.json";
import {Category, Collection, HomepageSection, Media, Product, ProductList} from "./types";

export type CatalogFilters={q?:string;category?:string;collection?:string;sort?:"recommended"|"newest"|"price-asc"|"price-desc";min_price?:number;max_price?:number;size?:string;color?:string;in_stock?:boolean;featured?:boolean;is_new?:boolean;sale?:boolean;limit?:number;offset?:number};
export type ApiResult<T>={data:T;isFallback:boolean};
export type StoreSettings=Record<string,string>;

const basePath=process.env.NEXT_PUBLIC_BASE_PATH||"";
const assetUrl=(url:string)=>url.startsWith("/")&&!url.startsWith("//")?`${basePath}${url}`:url;
const normalizeMedia=(media:Media)=>({...media,url:assetUrl(media.url)});
const normalizeProduct=(product:Product):Product=>({...product,media:product.media.map(normalizeMedia),variants:product.variants?.map(variant=>({...variant,media:variant.media?.map(normalizeMedia)}))});
const products=(productsSource.products as Product[]).map(normalizeProduct).filter(product=>product.status==="published");
const categories=(categoriesSource.categories as Category[]).map(category=>({...category,media_url:category.media_url?assetUrl(category.media_url):null})).filter(category=>category.is_visible!==false).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
const collections=(collectionsSource.collections as Collection[]).map(collection=>({...collection,media_url:collection.media_url?assetUrl(collection.media_url):null})).filter(collection=>collection.is_visible!==false).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
const homepage=(homepageSource.sections as HomepageSection[]).map(section=>({...section,content:{...section.content,media_url:typeof section.content.media_url==="string"?assetUrl(section.content.media_url):section.content.media_url,mobile_media_url:typeof section.content.mobile_media_url==="string"?assetUrl(section.content.mobile_media_url):section.content.mobile_media_url}}));
export const storeSettings=settingsSource.settings as StoreSettings;

function catalog(filters:CatalogFilters):ProductList{let items=[...products].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));const q=filters.q?.trim().toLocaleLowerCase();if(q)items=items.filter(product=>(product.name+product.category+product.short_description).toLocaleLowerCase().includes(q));if(filters.category)items=filters.category==="sale"?items.filter(product=>Boolean(product.compare_at_price)):items.filter(product=>(product as Product&{category_slug?:string}).category_slug===filters.category||product.category===filters.category);if(filters.collection)items=items.filter(product=>product.collections.includes(filters.collection!));if(filters.featured)items=items.filter(product=>product.is_featured);if(filters.is_new)items=items.filter(product=>product.is_new);if(filters.sale)items=items.filter(product=>Boolean(product.compare_at_price));if(filters.min_price!==undefined)items=items.filter(product=>product.price>=filters.min_price!);if(filters.max_price!==undefined)items=items.filter(product=>product.price<=filters.max_price!);if(filters.size)items=items.filter(product=>product.variants?.some(variant=>variant.options.size===filters.size));if(filters.color)items=items.filter(product=>product.variants?.some(variant=>variant.options.color===filters.color));if(filters.in_stock)items=items.filter(product=>product.variants?.some(variant=>variant.is_active&&variant.stock_quantity>0));if(filters.sort==="newest")items.reverse();if(filters.sort==="price-asc")items.sort((a,b)=>a.price-b.price);if(filters.sort==="price-desc")items.sort((a,b)=>b.price-a.price);const offset=filters.offset||0,limit=filters.limit||12;return {items:items.slice(offset,offset+limit),total:items.length,limit,offset}}

export async function getCatalog(filters:CatalogFilters={}):Promise<ApiResult<ProductList>>{return {data:catalog(filters),isFallback:false}}
export async function getCategories():Promise<ApiResult<Category[]>>{return {data:categories,isFallback:false}}
export async function getCollections():Promise<ApiResult<Collection[]>>{return {data:collections,isFallback:false}}
export async function getProducts(filters:CatalogFilters={}):Promise<Product[]>{return catalog({...filters,limit:filters.limit||48}).items}
export async function getProduct(slug:string):Promise<Product|undefined>{return products.find(product=>product.slug===slug)}
export async function getHomepage():Promise<HomepageSection[]>{return homepage}
export async function getStoreSettings():Promise<StoreSettings>{return storeSettings}
export const rub=(value:number)=>new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",maximumFractionDigits:0}).format(value/100);
