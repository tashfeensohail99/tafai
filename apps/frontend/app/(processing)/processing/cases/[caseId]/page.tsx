import { use } from 'react';
import { ProcessingCaseWorkspace } from '@/components/processing/ProcessingCaseWorkspace';

interface Props {
  params: Promise<{ caseId: string }>;
}

export default function CaseWorkspacePage({ params }: Props) {
  const { caseId } = use(params);
  return <ProcessingCaseWorkspace caseId={caseId} />;
}
