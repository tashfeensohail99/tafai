/**
 * Leak check: scans EVERY text-like column of EVERY table in the demo
 * database for production identifiers (phones, emails, national ids, full
 * names) read live from the read-only production role, and fails loudly on the
 * first hit. Runs after every full sync in CI-style, and on demand.
 *
 * Rows that belong to the live lane (a real prospect's own messages) are
 * skipped on purpose: those are not production data.
 */
import type { Pool, QueryResultRow } from 'pg';
import { FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES } from './masking.names';
import { normName, personalNameKeys } from './names-filter';

export interface LeakFinding {
  table: string;
  column: string;
  pk: string;
  kind: 'phone' | 'email' | 'national-id' | 'name';
  /** The matched identifier, partially masked so the report itself is safe to paste. */
  match: string;
}

export interface LeakReport {
  ok: boolean;
  scannedTables: number;
  scannedRows: number;
  scannedValues: number;
  realPhones: number;
  realEmails: number;
  realNames: number;
  ambiguousNamesSkipped: number;
  /** Every hit counted, even beyond maxFindings. */
  totalHits: number;
  findings: LeakFinding[];
  truncated: boolean;
  ms: number;
}

export interface LeakCheckOptions {
  livePhoneNumberIds: string[];
  /** Real staff identities deliberately kept (keep-list) — not leaks. */
  allowEmails?: string[];
  allowNames?: string[];
  maxFindings?: number;
  schemas?: string[];
  log?: (m: string) => void;
}

const DEFAULT_SCHEMAS = ['core', 'crm', 'whatsapp', 'ai', 'processing', 'finance', 'legal', 'audit', 'public'];
const SKIP_TABLES = new Set(['public._prisma_migrations', 'core.demo_access_links', 'core.demo_access_link_uses']);
/** Company content, never about one person: phones/emails/ids are still checked, names are not. */
const NO_NAME_CHECK_TABLES = new Set(['ai.knowledge', 'ai.brochures', 'whatsapp.templates', 'crm.quick_replies', 'processing.processing_email_templates', 'finance.agreement_templates', 'processing.document_requirement_templates']);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const DIGIT_RUN_RE = /\+?\d(?:[\s\-.()]?\d){8,14}/g;
const CNIC_RE = /\b\d{5}-?\d{7}-?\d\b/g;

function phoneVariants(raw: string): string[] {
  const d = raw.replace(/\D/g, '');
  if (d.length < 9) return [];
  const out = new Set<string>([d]);
  // PK: 92 3xx xxxxxxx ↔ 03xx xxxxxxx ↔ 3xx xxxxxxx
  if (d.startsWith('92') && d.length === 12) {
    out.add(d.slice(2));
    out.add(`0${d.slice(2)}`);
  } else if (d.startsWith('0') && d.length === 11) {
    out.add(`92${d.slice(1)}`);
    out.add(d.slice(1));
  } else if (d.length === 10 && d.startsWith('3')) {
    out.add(`92${d}`);
    out.add(`0${d}`);
  }
  // Generic: last 9 digits as a weak key is too loose; keep exact forms only.
  return [...out];
}

function maskSample(s: string): string {
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}…${s.slice(-2)}`;
}

export class DemoLeakChecker {
  private readonly log: (m: string) => void;
  constructor(
    private readonly source: Pool,
    private readonly target: Pool,
    private readonly opts: LeakCheckOptions,
  ) {
    this.log = opts.log ?? (() => undefined);
  }

  async run(): Promise<LeakReport> {
    const t0 = Date.now();
    const real = await this.loadRealIdentifiers();
    const live = await this.loadLiveLaneIds();
    this.log(`real identifiers: ${real.phones.size} phone forms, ${real.emails.size} emails, ${real.names.size} names (${real.ambiguous} ambiguous skipped), ${real.ids.size} ids`);
    this.log(`live lane: ${live.channelIds.size} channels, ${live.threadIds.size} threads, ${live.leadIds.size} leads`);

    const tables = await this.target.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_type = 'BASE TABLE' AND table_schema = ANY($1::text[])
        ORDER BY 1, 2`,
      [this.opts.schemas ?? DEFAULT_SCHEMAS],
    );
    const maxFindings = this.opts.maxFindings ?? 200;
    const findings: LeakFinding[] = [];
    let scannedTables = 0;
    let scannedRows = 0;
    let scannedValues = 0;
    let truncated = false;
    let totalHits = 0;

    for (const t of tables.rows) {
      const fq = `${t.table_schema}.${t.table_name}`;
      if (SKIP_TABLES.has(fq)) continue;
      const cols = await this.target.query<{ column_name: string; udt_name: string }>(
        `SELECT column_name, udt_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [t.table_schema, t.table_name],
      );
      const textCols = cols.rows.filter((c) => ['text', 'varchar', 'bpchar', 'json', 'jsonb', '_text'].includes(c.udt_name)).map((c) => c.column_name);
      if (!textCols.length) continue;
      const colNames = new Set(cols.rows.map((c) => c.column_name));
      const pkCol = colNames.has('id') ? 'id' : cols.rows[0].column_name;
      scannedTables++;

      const client = await this.target.connect();
      try {
        await client.query('BEGIN');
        const selectCols = [pkCol, ...textCols.filter((c) => c !== pkCol)]
          .concat(['channelId', 'threadId', 'leadId'].filter((c) => colNames.has(c) && !textCols.includes(c)))
          .map((c) => `"${c}"`)
          .join(', ');
        await client.query(`DECLARE leak_cur NO SCROLL CURSOR FOR SELECT ${selectCols} FROM "${t.table_schema}"."${t.table_name}"`);
        for (;;) {
          const page = await client.query<Record<string, unknown>>('FETCH 2000 FROM leak_cur');
          if (!page.rows.length) break;
          for (const row of page.rows) {
            scannedRows++;
            if (this.isLiveLaneRow(fq, row, live)) continue;
            for (const col of textCols) {
              const v = row[col];
              if (v == null) continue;
              const text = typeof v === 'string' ? v : JSON.stringify(v);
              if (!text) continue;
              scannedValues++;
              const hits = this.scanText(text, real, !NO_NAME_CHECK_TABLES.has(fq));
              for (const h of hits) {
                totalHits++;
                if (findings.length < maxFindings) {
                  findings.push({ table: fq, column: col, pk: String(row[pkCol]), kind: h.kind, match: maskSample(h.match) });
                } else {
                  truncated = true;
                }
              }
            }
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }

    return {
      ok: totalHits === 0,
      totalHits,
      scannedTables,
      scannedRows,
      scannedValues,
      realPhones: real.phones.size,
      realEmails: real.emails.size,
      realNames: real.names.size,
      ambiguousNamesSkipped: real.ambiguous,
      findings,
      truncated,
      ms: Date.now() - t0,
    };
  }

  // ── real identifiers from production (read-only) ──

  private async loadRealIdentifiers(): Promise<{
    phones: Set<string>;
    emails: Set<string>;
    names: Set<string>;
    ids: Set<string>;
    ambiguous: number;
  }> {
    const phones = new Set<string>();
    const emails = new Set<string>();
    const names = new Set<string>();
    const ids = new Set<string>();
    let ambiguous = 0;
    const allowEmails = new Set((this.opts.allowEmails ?? []).map((e) => e.toLowerCase()));
    const allowNames = new Set((this.opts.allowNames ?? []).map(normName));
    const poolFirst = new Set([...FIRST_NAMES_M, ...FIRST_NAMES_F].map((n) => n.toLowerCase()));
    const poolLast = new Set(LAST_NAMES.map((n) => n.toLowerCase()));

    const addPhone = (p: unknown) => {
      if (typeof p !== 'string' || /[A-Za-z]/.test(p)) return;
      for (const v of phoneVariants(p)) phones.add(v);
    };
    const addEmail = (e: unknown) => {
      if (typeof e !== 'string') return;
      const x = e.trim().toLowerCase();
      if (x.includes('@') && !allowEmails.has(x)) emails.add(x);
    };
    const addName = (first: unknown, last: unknown) => {
      const keys = personalNameKeys(String(first ?? ''), String(last ?? ''));
      if (!keys.length) {
        if (first && last) ambiguous++;
        return;
      }
      if (allowNames.has(keys[0])) return;
      const parts = keys[0].split(' ');
      const l = parts[parts.length - 1];
      // A name made purely of pool tokens can be regenerated by the masker for
      // someone else -> not a reliable detector. Count it, skip it.
      if (poolLast.has(l) && parts.slice(0, -1).every((p) => poolFirst.has(p))) {
        ambiguous++;
        return;
      }
      for (const k of keys) names.add(k);
    };
    const addId = (v: unknown) => {
      if (typeof v === 'string' && v.trim().length >= 6) ids.add(v.trim().toUpperCase().replace(/[\s-]/g, ''));
    };

    const q = async <T extends QueryResultRow>(sql: string): Promise<T[]> => (await this.source.query<T>(sql)).rows;

    for (const r of await q<{ firstName: string; lastName: string; email: string | null; phone: string; alternatePhone: string | null }>(
      'SELECT "firstName","lastName",email,phone,"alternatePhone" FROM crm.leads',
    )) {
      addPhone(r.phone); addPhone(r.alternatePhone); addEmail(r.email); addName(r.firstName, r.lastName);
    }
    for (const r of await q<{ firstName: string; lastName: string; email: string | null; phone: string | null; alternatePhone: string | null; cnic: string | null; passportNumber: string | null; nationalId: string | null }>(
      'SELECT "firstName","lastName",email,phone,"alternatePhone",cnic,"passportNumber","nationalId" FROM crm.clients',
    )) {
      addPhone(r.phone); addPhone(r.alternatePhone); addEmail(r.email); addName(r.firstName, r.lastName);
      addId(r.cnic); addId(r.passportNumber); addId(r.nationalId);
    }
    for (const r of await q<{ email: string; phone: string | null; firstName: string | null; lastName: string | null; nationalId: string | null; passportNumber: string | null }>(
      'SELECT u.email, u.phone, e."firstName", e."lastName", e."nationalId", e."passportNumber" FROM core.user_accounts u LEFT JOIN core.employees e ON e."userId" = u.id',
    )) {
      addEmail(r.email); addPhone(r.phone); addName(r.firstName, r.lastName); addId(r.nationalId); addId(r.passportNumber);
    }
    for (const r of await q<{ contactName: string; email: string | null; phone: string | null }>('SELECT "contactName",email,phone FROM core.partners')) {
      addEmail(r.email); addPhone(r.phone);
      const parts = normName(r.contactName ?? '').split(' ');
      if (parts.length >= 2) addName(parts.slice(0, -1).join(' '), parts[parts.length - 1]);
    }
    for (const r of await q<{ waContactId: string; platform: string }>(`SELECT "waContactId", platform FROM whatsapp.threads`)) {
      if (r.platform === 'WHATSAPP') addPhone(r.waContactId);
    }
    for (const r of await q<{ waId: string }>('SELECT "waId" FROM whatsapp.opt_outs')) addPhone(r.waId);
    for (const r of await q<{ phone: string | null }>('SELECT phone FROM crm.visits')) addPhone(r.phone);
    for (const r of await q<{ fromAddress: string }>('SELECT "fromAddress" FROM crm.incoming_emails')) addEmail(r.fromAddress);

    return { phones, emails, names, ids, ambiguous };
  }

  // ── live-lane rows in the demo (not production data) ──

  private async loadLiveLaneIds(): Promise<{ channelIds: Set<string>; threadIds: Set<string>; leadIds: Set<string> }> {
    const channelIds = new Set<string>();
    const threadIds = new Set<string>();
    const leadIds = new Set<string>();
    if (!this.opts.livePhoneNumberIds.length) return { channelIds, threadIds, leadIds };
    const ch = await this.target.query<{ id: string }>(`SELECT id FROM whatsapp.channels WHERE "phoneNumberId" = ANY($1::text[])`, [this.opts.livePhoneNumberIds]);
    for (const r of ch.rows) channelIds.add(r.id);
    if (!channelIds.size) return { channelIds, threadIds, leadIds };
    const th = await this.target.query<{ id: string; leadId: string | null }>(`SELECT id, "leadId" FROM whatsapp.threads WHERE "channelId" = ANY($1::text[])`, [[...channelIds]]);
    for (const r of th.rows) {
      threadIds.add(r.id);
      if (r.leadId) leadIds.add(r.leadId);
    }
    return { channelIds, threadIds, leadIds };
  }

  private isLiveLaneRow(fq: string, row: Record<string, unknown>, live: { channelIds: Set<string>; threadIds: Set<string>; leadIds: Set<string> }): boolean {
    if (fq === 'whatsapp.channels') return live.channelIds.has(String(row.id));
    if (fq === 'whatsapp.threads' || fq === 'crm.leads') {
      const id = String(row.id);
      if (fq === 'crm.leads') return live.leadIds.has(id);
      return live.threadIds.has(id);
    }
    const ch = row.channelId;
    if (typeof ch === 'string' && live.channelIds.has(ch)) return true;
    const th = row.threadId;
    if (typeof th === 'string' && live.threadIds.has(th)) return true;
    const ld = row.leadId;
    if (typeof ld === 'string' && live.leadIds.has(ld)) return true;
    return false;
  }

  // ── matching ──

  scanText(text: string, real: { phones: Set<string>; emails: Set<string>; names: Set<string>; ids: Set<string> }, checkNames = true): Array<{ kind: LeakFinding['kind']; match: string }> {
    const hits: Array<{ kind: LeakFinding['kind']; match: string }> = [];
    for (const m of text.match(EMAIL_RE) ?? []) {
      if (real.emails.has(m.toLowerCase())) hits.push({ kind: 'email', match: m });
    }
    for (const m of text.match(DIGIT_RUN_RE) ?? []) {
      const d = m.replace(/\D/g, '');
      if (real.phones.has(d)) hits.push({ kind: 'phone', match: d });
    }
    for (const m of text.match(CNIC_RE) ?? []) {
      if (real.ids.has(m.replace(/-/g, ''))) hits.push({ kind: 'national-id', match: m });
    }
    if (checkNames && real.names.size) {
      const words = normName(text).split(' ').filter(Boolean);
      for (let i = 0; i + 1 < words.length; i++) {
        const bigram = `${words[i]} ${words[i + 1]}`;
        if (real.names.has(bigram)) hits.push({ kind: 'name', match: bigram });
        if (i + 2 < words.length) {
          const trigram = `${bigram} ${words[i + 2]}`;
          if (real.names.has(trigram)) hits.push({ kind: 'name', match: trigram });
        }
      }
    }
    return hits;
  }
}
