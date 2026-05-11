'use client';

import { useParams } from 'next/navigation';
import { FinanceVerificationDetailPage } from '@/components/finance/FinanceVerificationDetailPage';

export default function FinanceVerificationDetailRoute() {
  const params = useParams<{ id: string }>();
  return <FinanceVerificationDetailPage paymentId={params.id} />;
}
