'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function MarketingReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      description="Downloadable marketing reporting — spend, performance and office comparison over any date range."
      bullets={[
        'Spend and performance by ad, campaign and destination',
        'Islamabad vs Lahore office comparison',
        'Export for management',
      ]}
    />
  );
}
