'use client';

import { useParams } from 'next/navigation';
import { SalesLeadProfilePage } from '@/components/employee/SalesLeadProfilePage';

export default function EmployeeLeadProfileRoute() {
  const params = useParams<{ id: string }>();
  return <SalesLeadProfilePage leadId={params.id} />;
}