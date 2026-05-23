'use client';

import { useParams } from 'next/navigation';
import { AgreementEditorPage } from '@/components/employee/AgreementEditorPage';

export default function Page() {
  const params = useParams<{ id: string }>();
  return <AgreementEditorPage agreementId={params.id} />;
}
