'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function MetaAdsPage() {
  return (
    <ComingSoon
      title="Meta Ads"
      description="Every ad with status, spend, leads, CPL, CTR and its lead-routing destination."
      bullets={[
        'Status at a glance: Active, Paused, Rejected, Scheduled, Completed',
        'Spend, leads and CPL per ad, current period vs previous',
        'The lead-routing destination (Islamabad / Lahore / Both) inline',
      ]}
    />
  );
}
