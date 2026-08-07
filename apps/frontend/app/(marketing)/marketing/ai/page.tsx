'use client';
import { ComingSoon } from '@/components/marketing/ComingSoon';

export default function AiInsightsPage() {
  return (
    <ComingSoon
      title="AI Insights"
      description="Structured, advisory recommendations from a compact summary of each ad's performance."
      bullets={[
        'Issue → Observation → Possible cause → Recommended action → Priority → Confidence',
        'Advisory only: never auto-changes budgets, pauses ads or edits targeting',
        'A human reviews and takes any action',
      ]}
    />
  );
}
