'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function PerformancePage() {
  return (
    <ComingSoon
      title="Performance"
      description="CPL, CTR, CPC, CPM and ROAS by ad — current period versus the previous one."
      bullets={[
        'Backend-computed metrics (no AI maths), current vs previous period',
        'Per-ad and blended cost figures',
        'Advertisement performance rating: Excellent → Poor',
      ]}
    />
  );
}
