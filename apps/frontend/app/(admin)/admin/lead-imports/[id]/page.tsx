import { LeadImportDetailPage } from '@/components/admin/LeadImportDetailPage';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminLeadImportDetailRoute({ params }: PageProps) {
  const { id } = await params;
  return <LeadImportDetailPage batchId={id} />;
}
