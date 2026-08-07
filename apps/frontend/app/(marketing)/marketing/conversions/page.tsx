'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function ConversionsPage() {
  return (
    <ComingSoon
      title="Conversions"
      description="The full funnel — impressions → clicks → leads → contacted → qualified → consultation → deal → paid client."
      bullets={[
        'Which advertisement generated paying clients, not just leads',
        'Qualified CPL and customer acquisition cost per ad',
        'Deferred to a later phase — attribution is being captured now so this backfills',
      ]}
    />
  );
}
