import { AdminGate } from "@/components/admin-gate";
import { AdminProductEditor } from "@/components/admin-product-editor";

export default function NewProductPage() { return <AdminGate><AdminProductEditor /></AdminGate>; }
