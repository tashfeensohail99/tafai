'use client';

import { useParams } from 'next/navigation';
import { FinanceCustomerProfilePage } from '@/components/finance/FinanceCustomerProfilePage';

export default function Page() {
  const params = useParams<{ id: string }>();
  return <FinanceCustomerProfilePage leadId={params.id} />;
}
