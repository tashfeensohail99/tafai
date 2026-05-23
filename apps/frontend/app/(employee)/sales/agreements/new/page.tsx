import { Suspense } from 'react';
import { AgreementNewPage } from '@/components/employee/AgreementNewPage';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AgreementNewPage />
    </Suspense>
  );
}
