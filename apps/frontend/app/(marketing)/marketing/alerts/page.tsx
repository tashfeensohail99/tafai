'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function AlertsPage() {
  return (
    <ComingSoon
      title="Alerts"
      description="Attention-worthy changes surfaced automatically from the synced ad data."
      bullets={[
        'Ad rejected · spending with no leads · CPL up 40% · CTR falling',
        'New high-performer · new ad detected · activated · paused',
        'Each links straight to the ad',
      ]}
    />
  );
}
