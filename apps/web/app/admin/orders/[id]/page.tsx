import {AdminGate} from "@/components/admin-gate";
import {AdminOrderDetail} from "@/components/admin-orders";
export const dynamicParams=false;
// This placeholder is removed from the static storefront output after build.
export function generateStaticParams(){return [{id:"static-disabled"}]}
export default async function OrderPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <AdminGate><AdminOrderDetail orderId={id}/></AdminGate>}
