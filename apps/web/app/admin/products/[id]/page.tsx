import { AdminGate } from "@/components/admin-gate";
import { AdminProductEditor } from "@/components/admin-product-editor";

export const dynamicParams = false;
// This placeholder is removed from the static storefront output after build.
export function generateStaticParams(){return [{id:"static-disabled"}]}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminGate><AdminProductEditor productId={id} /></AdminGate>;
}
