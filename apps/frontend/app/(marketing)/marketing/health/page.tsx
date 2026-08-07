'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function IntegrationHealthPage() {
  return (
    <ComingSoon
      title="Integration Health"
      description="Whether Meta is syncing — connection, last sync, last lead received, and any failures."
      bullets={[
        'Meta connection status, last ads sync, last insights sync',
        'Last lead received · next reconciliation',
        'Sync failures, API errors, token/permission issues — with admin alerting',
      ]}
    />
  );
}
