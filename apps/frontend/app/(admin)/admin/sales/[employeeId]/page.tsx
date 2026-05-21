import { SalesAgentDetailPage } from '@/components/admin/SalesAgentDetailPage';

interface PageProps {
  params: Promise<{ employeeId: string }>;
}

export default async function AdminSalesAgentDetailRoute({ params }: PageProps) {
  const { employeeId } = await params;
  return <SalesAgentDetailPage employeeId={employeeId} />;
}
