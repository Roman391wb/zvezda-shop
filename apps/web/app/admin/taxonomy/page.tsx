import { AdminGate } from "@/components/admin-gate";
import { AdminTaxonomyManager } from "@/components/admin-taxonomy-manager";

export default function TaxonomyPage() { return <AdminGate><AdminTaxonomyManager /></AdminGate>; }
