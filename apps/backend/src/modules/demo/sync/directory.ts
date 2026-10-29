import type { Pool } from 'pg';
import type { DemoMasker, NameAlias } from '../masking';
import type { PeopleDirectory, PersonRef, StaffRef } from './types';

/**
 * Load the real identities the masking rules need to resolve names
 * consistently across tables. Runs against the READ-ONLY source at the start
 * of every sync (≈80k small rows; well under a second on the pooler).
 */
export async function loadPeopleDirectory(source: Pool, masker: DemoMasker): Promise<PeopleDirectory> {
  const leads = new Map<string, PersonRef>();
  const clients = new Map<string, PersonRef>();
  const users = new Map<string, StaffRef>();
  const employeeUser = new Map<string, string>();

  const leadRows = await source.query<{
    id: string; firstName: string; lastName: string; phone: string | null; email: string | null;
  }>('SELECT id, "firstName", "lastName", phone, email FROM crm.leads');
  for (const r of leadRows.rows) {
    const key = masker.personKey({ phone: r.phone, email: r.email, id: r.id });
    leads.set(r.id, {
      id: r.id,
      key,
      real: { firstName: r.firstName ?? '', lastName: r.lastName ?? '' },
      fake: masker.person(key),
      realPhone: r.phone,
      realEmail: r.email,
      gender: null,
    });
  }

  const clientRows = await source.query<{
    id: string; firstName: string; lastName: string; phone: string | null; email: string | null;
    gender: string | null; sourceLeadId: string | null;
  }>('SELECT id, "firstName", "lastName", phone, email, gender, "sourceLeadId" FROM crm.clients');
  for (const r of clientRows.rows) {
    // A converted client keeps the lead's fake identity so the thread, the
    // lead card and the client card all show the same person.
    const fromLead = r.sourceLeadId ? leads.get(r.sourceLeadId) : undefined;
    const key = fromLead?.key ?? masker.personKey({ phone: r.phone, email: r.email, id: r.id });
    clients.set(r.id, {
      id: r.id,
      key,
      real: { firstName: r.firstName ?? '', lastName: r.lastName ?? '' },
      fake: fromLead?.fake ?? masker.person(key, { gender: r.gender }),
      realPhone: r.phone,
      realEmail: r.email,
      gender: r.gender,
    });
  }

  const staffRows = await source.query<{
    userId: string; email: string; employeeId: string | null; firstName: string | null; lastName: string | null; gender: string | null;
  }>(
    `SELECT u.id AS "userId", u.email, e.id AS "employeeId", e."firstName", e."lastName", e.gender
       FROM core.user_accounts u
       LEFT JOIN core.employees e ON e."userId" = u.id`,
  );
  const staffAliases: NameAlias[] = [];
  for (const r of staffRows.rows) {
    const real = { firstName: r.firstName ?? '', lastName: r.lastName ?? '' };
    const fake = masker.staff(r.email, r.userId, { gender: r.gender });
    const fakeEmail = masker.staffEmail(r.email, r.userId) ?? r.email;
    users.set(r.userId, { userId: r.userId, realEmail: r.email, real, fake, fakeEmail });
    if (r.employeeId) employeeUser.set(r.employeeId, r.userId);
    if (fake && (real.firstName || real.lastName)) staffAliases.push({ real, fake });
  }

  return { leads, clients, users, employeeUser, staffAliases };
}
