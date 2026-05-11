'use client';
import { useParams } from 'next/navigation';
import { FinanceCorrectionDetailPage } from '@/components/finance/FinanceCorrectionDetailPage';

export default function FinanceCorrectionDetailRoute() {
  const params = useParams<{ id: string }>();
  return <FinanceCorrectionDetailPage paymentId={params.id} />;
}
