'use client';

import { useParams } from 'next/navigation';
import { SalesFollowUpDetailPage } from '@/components/employee/SalesFollowUpDetailPage';

export default function FollowUpDetailRoute() {
  const params = useParams<{ id: string }>();
  return <SalesFollowUpDetailPage followUpId={params.id} />;
}
