import { ServiceContractDetailPage } from '@/components/finance/ServiceContractDetailPage';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FinanceContractDetailRoute({ params }: PageProps) {
  const { id } = await params;
  return <ServiceContractDetailPage contractId={id} />;
}
