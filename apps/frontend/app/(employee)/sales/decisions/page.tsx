'use client';
import { useSearchParams } from 'next/navigation';
import { SalesDecisionsPage } from '@/components/employee/SalesDecisionsPage';

export default function EmployeeDecisionsPage() {
  const searchParams = useSearchParams();
  return <SalesDecisionsPage preselectedLeadId={searchParams.get('leadId') ?? ''} />;
}