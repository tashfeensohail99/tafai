'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function LeadRoutingPage() {
  return (
    <ComingSoon
      title="Lead Routing"
      description="Point each ad or campaign at Islamabad, Lahore or Both — editable here, no developer needed."
      bullets={[
        'Per-ad and per-campaign destination rules, stored in the database',
        '“Both” round-robins one lead across both offices — never duplicates it',
        'Takes effect on the next lead the ad produces',
      ]}
    />
  );
}
