// Admin calls run in the browser and must never leave the current storefront origin.
const base="";
export async function adminApi<T>(path:string,init:RequestInit={}):Promise<T>{const headers=new Headers(init.headers);if(init.body&&!headers.has("Content-Type")&&!(init.body instanceof FormData))headers.set("Content-Type","application/json");const response=await fetch(`${base}/api/admin${path}`,{...init,headers,credentials:"include"});if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.detail||"Не удалось выполнить запрос")};return response.status===204?undefined as T:response.json()}
export const adminMediaUrl=(path:string)=>path.startsWith("http")?path:`${base}${path}`;
