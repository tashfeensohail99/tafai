'use client';

import { useParams } from 'next/navigation';
import { FinanceAgreementReviewPage } from '@/components/finance/FinanceAgreementReviewPage';

export default function Page() {
  const params = useParams<{ id: string }>();
  return <FinanceAgreementReviewPage agreementId={params.id} />;
}
