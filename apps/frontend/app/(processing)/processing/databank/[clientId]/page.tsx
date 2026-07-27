import { use } from 'react';
import { DatabankClientDetail } from '@/components/processing/DatabankClientDetail';

interface Props {
  params: Promise<{ clientId: string }>;
}

export default function DatabankClientPage({ params }: Props) {
  const { clientId } = use(params);
  return <DatabankClientDetail clientId={clientId} />;
}
