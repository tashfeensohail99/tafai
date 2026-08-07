'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function MarketingLeadsPage() {
  return (
    <ComingSoon
      title="Meta Leads"
      description="Leads sourced from Meta ads, each permanently attributed to the ad, ad set and campaign that produced it."
      bullets={[
        'Attribution captured at lead creation so it survives conversion to client',
        'Filter by ad / campaign / destination team',
        'Links through to the CRM lead record',
      ]}
    />
  );
}
