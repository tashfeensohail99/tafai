'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function CampaignsPage() {
  return (
    <ComingSoon
      title="Campaigns"
      description="The Meta hierarchy — Campaign → Ad Set → Ad — synced from the Graph API and drillable."
      bullets={[
        'Drill from campaign to ad set to individual ad',
        'Objective, effective status, budget, spend and dates',
        'Synced on a schedule into current-state tables (never on page load)',
      ]}
    />
  );
}
