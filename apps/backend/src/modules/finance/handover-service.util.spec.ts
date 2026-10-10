import { resolveHandoverService } from './handover-service.util';

const mk = (templateId: string | null, categoryKey: string | null) => ({
  agreement: { findUnique: async () => (templateId ? { templateId } : null) },
  agreementTemplate: { findUnique: async () => (categoryKey ? { categoryKey } : null) },
});

describe('resolveHandoverService (route by agreement template, not lead tag)', () => {
  it('JR template → JR_RESUBMISSION even when the lead is tagged visit visa', async () => {
    const r = await resolveHandoverService(mk('t1', 'JR') as any, { agreementId: 'a1', lead: { serviceInterest: 'VISIT_VISA' } });
    expect(r).toBe('JR_RESUBMISSION');
  });
  it('Visit Visa template → VISIT_VISA even when the lead is tagged JR (finance report)', async () => {
    const r = await resolveHandoverService(mk('t1', 'VISIT_VISA') as any, { agreementId: 'a1', lead: { serviceInterest: 'JR_RESUBMISSION' } });
    expect(r).toBe('VISIT_VISA');
  });
  it('C11 template → WORK_PERMIT', async () => {
    expect(await resolveHandoverService(mk('t1', 'C11') as any, { agreementId: 'a1', lead: { serviceInterest: null } })).toBe('WORK_PERMIT');
  });
  it('manual handover (no agreement) → falls back to the lead tag', async () => {
    const r = await resolveHandoverService(mk(null, null) as any, { agreementId: null, lead: { serviceInterest: 'STUDY_VISA' } });
    expect(r).toBe('STUDY_VISA');
  });
  it('unmapped template category → falls back to the lead tag', async () => {
    const r = await resolveHandoverService(mk('t1', 'GENERAL') as any, { agreementId: 'a1', lead: { serviceInterest: 'PR_CASE' } });
    expect(r).toBe('PR_CASE');
  });
});
