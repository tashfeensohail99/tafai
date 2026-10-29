/**
 * Generic table copier: SOURCE (read-only production role) → TARGET (demo DB)
 * through the masking rules. Pure node-postgres, no Prisma, so it runs as a
 * CLI, inside the Nest demo service, and in integration tests against any
 * Postgres that has the same table shapes.
 *
 * Key properties
 *  - Column lists are introspected from the TARGET (its schema is what the
 *    demo app expects); only columns that also exist on the source are copied.
 *    Generated columns (tsvector) are skipped.
 *  - Writes are `INSERT … ON CONFLICT (pk) DO UPDATE … WHERE row IS DISTINCT`,
 *    so re-runs are idempotent and unchanged rows produce no dead tuples.
 *  - Every text / varchar / json column that has no explicit rule is passed
 *    through the generic scrubber (phones, emails, CNICs, names, brand), so a
 *    forgotten column cannot leak an identifier by default.
 *  - Timestamps are moved as raw strings (identity type parsers) so no
 *    timezone shift can creep in between the two databases.
 */
import { Pool, types } from 'pg';
import { DemoMasker, type NameAlias } from '../masking';
import { loadPeopleDirectory } from './directory';
import type {
  ColumnRule,
  PeopleDirectory,
  PersonRef,
  Row,
  RowContext,
  StaffRef,
  SyncOptions,
  SyncResult,
  TableResult,
  TableRule,
} from './types';

// Identity parsers: keep timestamps / dates / numerics / int8 as the exact
// text Postgres produced so they round-trip byte-for-byte.
for (const oid of [1114, 1184, 1082, 1083, 1266, 20, 1700]) types.setTypeParser(oid, (v: string) => v);
// Arrays of timestamps are rare here; leave the defaults.

export interface ColumnMeta {
  name: string;
  dataType: string; // information_schema.data_type
  udt: string; // udt_name, e.g. _text, jsonb, vector
  generated: boolean;
}

export interface TableMeta {
  schema: string;
  table: string;
  columns: ColumnMeta[];
  pk: string[];
}

const SYNC_SCHEMA = 'demo_sync';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DemoSyncEngine {
  constructor(
    private readonly source: Pool,
    private readonly target: Pool,
    private readonly masker: DemoMasker,
    private readonly rules: TableRule[],
  ) {}

  // ───────────────────────────── public API ──────────────────────────────

  async run(opts: SyncOptions): Promise<SyncResult> {
    const log = opts.log ?? (() => undefined);
    const startedAt = new Date();
    await this.ensureStateTable();
    const addedEnums = await this.syncEnumValues();
    if (addedEnums.length) log(`enum values added on target: ${addedEnums.join(', ')}`);
    const people = await loadPeopleDirectory(this.source, this.masker);
    log(`directory: ${people.leads.size} leads, ${people.clients.size} clients, ${people.users.size} users`);

    const results: TableResult[] = [];
    const wanted = opts.tables?.length ? new Set(opts.tables) : null;
    for (const rule of this.rules) {
      if (wanted && !wanted.has(rule.table)) continue;
      const t0 = Date.now();
      try {
        const r = await this.syncTable(rule, people, opts, startedAt, log);
        results.push({ ...r, ms: Date.now() - t0 });
        log(`${rule.table}: ${r.mode} read=${r.read} written=${r.written} pruned=${r.pruned} skipped=${r.skipped} (${Date.now() - t0}ms)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ table: rule.table, mode: rule.mode, read: 0, written: 0, pruned: 0, skipped: 0, ms: Date.now() - t0, error: message });
        log(`${rule.table}: ERROR ${message}`);
      }
    }
    const finishedAt = new Date();
    const ok = results.every((r) => !r.error);
    if (!opts.dryRun) {
      await this.target.query(
        `INSERT INTO ${SYNC_SCHEMA}.runs ("startedAt","finishedAt","isFull",ok,summary) VALUES ($1,$2,$3,$4,$5)`,
        [startedAt.toISOString(), finishedAt.toISOString(), !!opts.full, ok, JSON.stringify(results)],
      );
    }
    return { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), full: !!opts.full, tables: results, ok };
  }

  /** Mask one row with a rule (exposed for unit tests). */
  maskRow(rule: TableRule, row: Row, meta: TableMeta, people: PeopleDirectory): Row {
    const ctx = this.contextFor(rule, row, people);
    const out: Row = {};
    for (const col of meta.columns) {
      if (col.generated) continue;
      if (!(col.name in row)) continue;
      const value = row[col.name];
      const r = rule.columns[col.name];
      out[col.name] = r ? this.applyRule(r, value, row, ctx, col) : this.applyDefault(value, ctx, col, meta);
    }
    return out;
  }

  // ───────────────────────────── internals ───────────────────────────────

  private async ensureStateTable(): Promise<void> {
    await this.target.query(`CREATE SCHEMA IF NOT EXISTS ${SYNC_SCHEMA}`);
    await this.target.query(
      `CREATE TABLE IF NOT EXISTS ${SYNC_SCHEMA}.state (
         "table" text PRIMARY KEY,
         watermark text,
         "lastRunAt" timestamptz,
         "lastFullAt" timestamptz,
         "rowsCopied" bigint NOT NULL DEFAULT 0
       )`,
    );
    await this.target.query(
      `CREATE TABLE IF NOT EXISTS ${SYNC_SCHEMA}.runs (
         id bigserial PRIMARY KEY,
         "startedAt" timestamptz NOT NULL,
         "finishedAt" timestamptz NOT NULL,
         "isFull" boolean NOT NULL,
         ok boolean NOT NULL,
         summary jsonb NOT NULL
       )`,
    );
  }

  /**
   * Production has enum values that were added by hand and never made it into
   * a migration (e.g. ClientStatus UNDER_PROCESSING). Copying such a row would
   * fail, so before every run add any source enum value missing on the target
   * (ALTER TYPE … ADD VALUE is additive and cannot run inside a transaction).
   */
  async syncEnumValues(): Promise<string[]> {
    const sql = `SELECT n.nspname AS schema, t.typname AS type, e.enumlabel AS label, e.enumsortorder AS ord
                   FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                  ORDER BY 1, 2, 4`;
    type EnumRow = { schema: string; type: string; label: string; ord: number };
    const [src, dst] = await Promise.all([this.source.query<EnumRow>(sql), this.target.query<EnumRow>(sql)]);
    const have = new Set(dst.rows.map((r) => `${r.schema}.${r.type}:${r.label}`));
    const targetTypes = new Set(dst.rows.map((r) => `${r.schema}.${r.type}`));
    const added: string[] = [];
    for (const r of src.rows) {
      const type = `${r.schema}.${r.type}`;
      if (!targetTypes.has(type) || have.has(`${type}:${r.label}`)) continue;
      await this.target.query(`ALTER TYPE ${q(r.schema)}.${q(r.type)} ADD VALUE IF NOT EXISTS ${lit(r.label)}`);
      added.push(`${type}:${r.label}`);
    }
    return added;
  }

  async tableMeta(pool: Pool, fq: string): Promise<TableMeta | null> {
    const [schema, table] = fq.split('.');
    const cols = await pool.query<{ column_name: string; data_type: string; udt_name: string; is_generated: string }>(
      `SELECT column_name, data_type, udt_name, is_generated
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [schema, table],
    );
    if (!cols.rowCount) return null;
    const pk = await pool.query<{ column_name: string }>(
      `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position`,
      [schema, table],
    );
    return {
      schema,
      table,
      columns: cols.rows.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        udt: c.udt_name,
        generated: c.is_generated === 'ALWAYS',
      })),
      pk: pk.rows.map((r) => r.column_name),
    };
  }

  private async syncTable(
    rule: TableRule,
    people: PeopleDirectory,
    opts: SyncOptions,
    runStartedAt: Date,
    log: (m: string) => void,
  ): Promise<Omit<TableResult, 'ms'>> {
    const targetMeta = await this.tableMeta(this.target, rule.table);
    if (!targetMeta) throw new Error(`target table ${rule.table} does not exist (run migrations on the demo DB first)`);
    if (!targetMeta.pk.length) throw new Error(`target table ${rule.table} has no primary key`);
    const sourceMeta = await this.tableMeta(this.source, rule.table);
    if (!sourceMeta) throw new Error(`source table ${rule.table} does not exist`);
    const sourceCols = new Set(sourceMeta.columns.map((c) => c.name));
    // Columns we will move: present on both sides, not generated on target.
    const meta: TableMeta = {
      ...targetMeta,
      columns: targetMeta.columns.filter((c) => !c.generated && sourceCols.has(c.name)),
    };
    for (const col of Object.keys(rule.columns)) {
      if (!sourceCols.has(col) && !targetMeta.columns.some((c) => c.name === col)) {
        log(`${rule.table}: rule references unknown column "${col}" (ignored)`);
      }
    }

    const full = opts.full || rule.mode === 'full';
    const mode: 'full' | 'incremental' = full ? 'full' : 'incremental';
    const wmCol = rule.watermarkColumn ?? 'updatedAt';
    const hasWatermark = sourceCols.has(wmCol);
    let watermark: string | null = null;
    if (!full) {
      if (!hasWatermark) throw new Error(`${rule.table}: incremental mode needs column "${wmCol}"`);
      const st = await this.target.query<{ watermark: string | null }>(
        `SELECT watermark FROM ${SYNC_SCHEMA}.state WHERE "table" = $1`,
        [rule.table],
      );
      watermark = st.rows[0]?.watermark ?? null;
      if (!watermark) {
        // Never synced → behave like a full run for this table.
        return this.syncTable({ ...rule, mode: 'full' }, people, { ...opts, full: false }, runStartedAt, log);
      }
    }

    // Order by the PK for keyset pagination (uuid text sorts fine).
    const pkCols = meta.pk;
    const selectCols = meta.columns.map((c) => q(c.name)).join(', ');
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (rule.where) whereParts.push(`(${rule.where})`);
    if (watermark) {
      params.push(watermark);
      whereParts.push(`${q(wmCol)} > $${params.length}`);
    }

    const fetchSize = rule.fetchSize ?? 2000;
    const batchSize = rule.batchSize ?? 400;
    let read = 0;
    let written = 0;
    let skipped = 0;
    let lastKey: unknown[] | null = null;
    const sourceIds: unknown[][] = [];

    for (;;) {
      const pageParams = [...params];
      const pageWhere = [...whereParts];
      if (lastKey) {
        const ph = lastKey.map((v) => {
          pageParams.push(v);
          return `$${pageParams.length}`;
        });
        pageWhere.push(`(${pkCols.map(q).join(', ')}) > (${ph.join(', ')})`);
      }
      const limit = opts.limit ? Math.min(fetchSize, Math.max(0, opts.limit - read)) : fetchSize;
      if (limit <= 0) break;
      const sql =
        `SELECT ${selectCols} FROM ${qfq(rule.table)}` +
        (pageWhere.length ? ` WHERE ${pageWhere.join(' AND ')}` : '') +
        ` ORDER BY ${pkCols.map(q).join(', ')} LIMIT ${limit}`;
      const page = await this.source.query<Row>(sql, pageParams);
      if (!page.rows.length) break;
      read += page.rows.length;
      lastKey = pkCols.map((c) => page.rows[page.rows.length - 1][c]);
      if (full && rule.prune !== false) for (const r of page.rows) sourceIds.push(pkCols.map((c) => r[c]));

      const masked = page.rows.map((r) => this.maskRow(rule, r, meta, people));
      if (!opts.dryRun) {
        for (let i = 0; i < masked.length; i += batchSize) {
          const chunk = masked.slice(i, i + batchSize);
          const res = await this.upsert(meta, rule, chunk, log);
          written += res.written;
          skipped += res.skipped;
        }
      }
      if (page.rows.length < limit) break;
    }

    let pruned = 0;
    if (full && rule.prune !== false && !opts.dryRun && !opts.limit) {
      pruned = await this.prune(meta, rule, sourceIds, opts);
    }

    if (!opts.dryRun) {
      // Watermark = run start minus a safety margin, so rows updated while we
      // were copying are picked up again next run (upserts are idempotent).
      const nextWatermark = hasWatermark ? new Date(runStartedAt.getTime() - 2 * 60_000).toISOString().replace('T', ' ').replace('Z', '') : null;
      await this.target.query(
        `INSERT INTO ${SYNC_SCHEMA}.state ("table", watermark, "lastRunAt", "lastFullAt", "rowsCopied")
         VALUES ($1, $2, now(), CASE WHEN $3 THEN now() ELSE NULL END, $4)
         ON CONFLICT ("table") DO UPDATE SET
           watermark = COALESCE(EXCLUDED.watermark, ${SYNC_SCHEMA}.state.watermark),
           "lastRunAt" = now(),
           "lastFullAt" = CASE WHEN $3 THEN now() ELSE ${SYNC_SCHEMA}.state."lastFullAt" END,
           "rowsCopied" = ${SYNC_SCHEMA}.state."rowsCopied" + EXCLUDED."rowsCopied"`,
        [rule.table, nextWatermark, full, written],
      );
    }

    return { table: rule.table, mode, read, written, pruned, skipped };
  }

  private async upsert(meta: TableMeta, rule: TableRule, rows: Row[], log: (m: string) => void): Promise<{ written: number; skipped: number }> {
    if (!rows.length) return { written: 0, skipped: 0 };
    const cols = meta.columns.map((c) => c.name);
    const nonPk = cols.filter((c) => !meta.pk.includes(c));
    const values: unknown[] = [];
    const tuples = rows.map((r) => {
      const ph = cols.map((c) => {
        values.push(this.toParam(r[c], meta.columns.find((m) => m.name === c)!));
        return `$${values.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    const setClause = nonPk.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ');
    const distinct = nonPk.length
      ? ` WHERE (${nonPk.map((c) => `t.${q(c)}`).join(', ')}) IS DISTINCT FROM (${nonPk.map((c) => `EXCLUDED.${q(c)}`).join(', ')})`
      : '';
    const sql =
      `INSERT INTO ${qfq(rule.table)} AS t (${cols.map(q).join(', ')}) VALUES ${tuples.join(', ')}` +
      ` ON CONFLICT (${meta.pk.map(q).join(', ')})` +
      (nonPk.length ? ` DO UPDATE SET ${setClause}${distinct}` : ' DO NOTHING');
    try {
      await this.target.query(sql, values);
      return { written: rows.length, skipped: 0 };
    } catch (err) {
      if (rows.length === 1) {
        const message = err instanceof Error ? err.message : String(err);
        log(`${rule.table}: skip row ${JSON.stringify(meta.pk.map((c) => rows[0][c]))}: ${message.split('\n')[0]}`);
        return { written: 0, skipped: 1 };
      }
      // A batch failed (typically an FK to a row that arrived mid-run). Fall
      // back to row-by-row so one bad row doesn't block the rest; the
      // overlapping watermark re-copies it next run.
      let written = 0;
      let skipped = 0;
      for (const r of rows) {
        const one = await this.upsert(meta, rule, [r], log);
        written += one.written;
        skipped += one.skipped;
      }
      return { written, skipped };
    }
  }

  private async prune(meta: TableMeta, rule: TableRule, sourceIds: unknown[][], opts: SyncOptions): Promise<number> {
    if (meta.pk.length !== 1) return 0; // composite PKs: no prune (none of the synced tables need it)
    const pk = meta.pk[0];
    const ids = sourceIds.map((k) => k[0]);
    // Load the ids into a temp table so the anti-join stays fast on big tables.
    const client = await this.target.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TEMP TABLE demo_sync_ids (id text PRIMARY KEY) ON COMMIT DROP');
      for (let i = 0; i < ids.length; i += 5000) {
        const chunk = ids.slice(i, i + 5000);
        await client.query('INSERT INTO demo_sync_ids (id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [chunk]);
      }
      // Both params are always bound (and typed) so an exclusion predicate may
      // reference either $1 (live phone_number_ids) or $2 (protected user ids).
      const exclude = rule.pruneExcludeSql
        ? ` AND $1::text[] IS NOT NULL AND $2::text[] IS NOT NULL AND NOT (${rule.pruneExcludeSql})`
        : '';
      const res = await client.query(
        `DELETE FROM ${qfq(rule.table)} t
          WHERE NOT EXISTS (SELECT 1 FROM demo_sync_ids s WHERE s.id = t.${q(pk)}::text)${exclude}`,
        rule.pruneExcludeSql ? [opts.livePhoneNumberIds, opts.protectedUserIds] : [],
      );
      await client.query('COMMIT');
      return res.rowCount ?? 0;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // ───────────────────────────── masking ─────────────────────────────────

  private contextFor(rule: TableRule, row: Row, people: PeopleDirectory): RowContext {
    const person = rule.person ? rule.person(row, people) ?? null : this.guessPerson(row, people);
    const staff = rule.staff ? rule.staff(row, people) ?? null : null;
    const names: NameAlias[] = [...people.staffAliases];
    if (person && (person.real.firstName || person.real.lastName)) names.push({ real: person.real, fake: person.fake });
    if (rule.extraNames) names.push(...rule.extraNames(row, people));
    return { masker: this.masker, people, table: rule.table, person, staff, names };
  }

  /** Default person resolution: leadId → clientId → (row is a lead/client itself). */
  private guessPerson(row: Row, people: PeopleDirectory): PersonRef | null {
    const leadId = row.leadId as string | undefined;
    if (leadId && people.leads.has(leadId)) return people.leads.get(leadId)!;
    const clientId = row.clientId as string | undefined;
    if (clientId && people.clients.has(clientId)) return people.clients.get(clientId)!;
    return null;
  }

  private applyRule(rule: ColumnRule, value: unknown, row: Row, ctx: RowContext, col: ColumnMeta): unknown {
    const m = ctx.masker;
    const str = value == null ? null : String(value);
    switch (rule.kind) {
      case 'keep':
        return value;
      case 'null':
        return null;
      case 'const':
        return rule.value;
      case 'phone':
        return m.phone(str);
      case 'waId':
        return str == null ? null : m.waId(str);
      case 'email':
        return str == null ? null : m.email(str, ctx.person?.key);
      case 'staffEmail':
        return str == null ? null : (ctx.staff?.fakeEmail ?? m.staffEmail(str, (row.id as string) ?? str));
      case 'firstName':
        return ctx.staff ? (ctx.staff.fake ? ctx.staff.fake.firstName : value) : (ctx.person?.fake.firstName ?? (str ? m.person(`name:${str}`).firstName : value));
      case 'lastName':
        return ctx.staff ? (ctx.staff.fake ? ctx.staff.fake.lastName : value) : (ctx.person?.fake.lastName ?? (str ? m.person(`name:${str}`).lastName : value));
      case 'fullName': {
        if (str == null) return null;
        const p = ctx.person?.fake ?? m.person(`name:${str}`);
        return `${p.firstName} ${p.lastName}`;
      }
      case 'cnic':
        return m.cnic(str);
      case 'passport':
        return m.passport(str);
      case 'nationalId':
        return m.nationalId(str);
      case 'dob': {
        if (str == null) return null;
        const d = m.dateOfBirth(new Date(str.endsWith('Z') || /[+-]\d\d(:?\d\d)?$/.test(str) ? str : `${str}Z`), ctx.person?.key ?? ctx.staff?.userId ?? (row.id as string) ?? 'x');
        return d ? d.toISOString().replace('T', ' ').replace('Z', '') : null;
      }
      case 'address':
        return str == null ? null : m.address(ctx.person?.key ?? (row.id as string) ?? str);
      case 'company':
        return str == null ? null : m.companyName((row.id as string) ?? str);
      case 'secret':
        return str == null ? null : m.secret(col.name, str);
      case 'media':
        return str == null ? null : DemoMasker.MEDIA_PLACEHOLDER;
      case 'fileName':
        return m.fileName(str);
      case 'text':
        return m.scrubText(str, { names: ctx.names });
      case 'json':
        return value == null ? null : m.scrubJson(value, { names: ctx.names });
      case 'messagePayload':
        return value == null ? null : m.scrubMessagePayload(value, { names: ctx.names, fakeProfileName: ctx.person?.fake.firstName });
      case 'fn':
        return rule.fn(value, row, ctx);
    }
  }

  /** Columns without an explicit rule: scrub anything text-like, copy the rest. */
  private applyDefault(value: unknown, ctx: RowContext, col: ColumnMeta, meta?: TableMeta): unknown {
    if (value == null) return value;
    // Identifiers are never scrubbed: primary keys, "<x>Id" foreign keys and
    // anything shaped like a UUID. (A UUID can contain a 10+ digit run that
    // the phone pattern would otherwise rewrite, silently breaking the key.)
    if (meta?.pk.includes(col.name) || col.name === 'id' || /Id$/.test(col.name)) return value;
    if (col.udt === 'json' || col.udt === 'jsonb') return ctx.masker.scrubJson(value, { names: ctx.names });
    if (col.udt === 'text' || col.udt === 'varchar' || col.udt === 'bpchar') {
      const s = String(value);
      if (UUID_RE.test(s)) return s;
      // Enum-like / identifier strings (no spaces, no @, short) are left alone;
      // anything that looks like prose or contains a digit run gets scrubbed.
      if (/^[A-Za-z0-9_:.\-/]{0,64}$/.test(s) && !/\d{10,}/.test(s)) return s;
      return ctx.masker.scrubText(s, { names: ctx.names });
    }
    if (col.udt === '_text' && Array.isArray(value)) {
      return value.map((v) => (typeof v === 'string' ? ctx.masker.scrubText(v, { names: ctx.names }) : v));
    }
    return value;
  }

  private toParam(value: unknown, col: ColumnMeta): unknown {
    if (value == null) return null;
    if (col.udt === 'json' || col.udt === 'jsonb') return JSON.stringify(value);
    return value;
  }
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
function qfq(fq: string): string {
  const [s, t] = fq.split('.');
  return `${q(s)}.${q(t)}`;
}

export function poolFromUrl(url: string, opts?: { max?: number; readOnly?: boolean; statementTimeoutMs?: number }): Pool {
  // Decide TLS here and strip sslmode from the URL: node-postgres would
  // otherwise re-derive a strict verify-full policy from the query string and
  // reject the hosted databases' (Supabase pooler / Railway proxy) certificates.
  const wantsTls = /sslmode=(require|prefer|verify-ca|verify-full)|supabase\.co|supabase\.com|railway\.app|rlwy\.net|railway\.internal/.test(url);
  const cleanUrl = url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
  const pool = new Pool({
    connectionString: cleanUrl,
    max: opts?.max ?? 4,
    ssl: wantsTls && !/railway\.internal/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('connect', (client) => {
    const stmts: string[] = [`SET TIME ZONE 'UTC'`];
    if (opts?.readOnly) stmts.push('SET default_transaction_read_only = on');
    if (opts?.statementTimeoutMs) stmts.push(`SET statement_timeout = ${Math.floor(opts.statementTimeoutMs)}`);
    client.query(stmts.join('; ')).catch(() => undefined);
  });
  return pool;
}

export { DemoMasker };
