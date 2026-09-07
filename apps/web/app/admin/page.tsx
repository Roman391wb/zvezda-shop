import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminGate } from "@/components/admin-gate";

export default function AdminPage() { return <AdminGate><AdminDashboard /></AdminGate>; }
