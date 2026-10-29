import type { DemoMasker, NameAlias, PersonName } from '../masking';

/** A row as returned by node-postgres with the identity type parsers installed. */
export type Row = Record<string, unknown>;

/** Real identities loaded from the SOURCE at the start of every run. */
export interface PeopleDirectory {
  /** Lead id → real identity + person key. */
  leads: Map<string, PersonRef>;
  /** Client id → real identity + person key (shares the lead key when converted). */
  clients: Map<string, PersonRef>;
  /** UserAccount id → staff identity (null fake = keep real). */
  users: Map<string, StaffRef>;
  /** Employee id → UserAccount id. */
  employeeUser: Map<string, string>;
  /** Every staff alias, applied to all free text. */
  staffAliases: NameAlias[];
  /** Every real person's normalised full name -> fake name (see names-filter). */
  nameIndex: Map<string, PersonName>;
}

export interface PersonRef {
  id: string;
  key: string;
  real: PersonName;
  fake: PersonName;
  realPhone: string | null;
  realEmail: string | null;
  gender: string | null;
}

export interface StaffRef {
  userId: string;
  realEmail: string;
  real: PersonName;
  /** null → identity kept as-is (keep-list). */
  fake: PersonName | null;
  fakeEmail: string;
}

export interface RowContext {
  masker: DemoMasker;
  people: PeopleDirectory;
  table: string;
  /** Resolved for this row by TableRule.person (lead/client/staff). */
  person?: PersonRef | null;
  staff?: StaffRef | null;
  /** Name aliases to scrub out of this row's free text. */
  names: NameAlias[];
  /** Global real-name index (omitted for company-content tables). */
  nameIndex?: Map<string, PersonName>;
}

export type ColumnRule =
  | { kind: 'keep' }
  | { kind: 'null' }
  | { kind: 'const'; value: unknown }
  | { kind: 'phone' }
  | { kind: 'waId' }
  | { kind: 'email' }
  | { kind: 'staffEmail' }
  | { kind: 'firstName' }
  | { kind: 'lastName' }
  | { kind: 'fullName' }
  | { kind: 'cnic' }
  | { kind: 'passport' }
  | { kind: 'nationalId' }
  | { kind: 'dob' }
  | { kind: 'address' }
  | { kind: 'company' }
  | { kind: 'secret' }
  | { kind: 'media' }
  | { kind: 'fileName' }
  | { kind: 'text' }
  | { kind: 'json' }
  | { kind: 'messagePayload' }
  | { kind: 'fn'; fn: (value: unknown, row: Row, ctx: RowContext) => unknown };

export interface TableRule {
  /** Fully qualified "schema.table". */
  table: string;
  /** Short description shown in logs. */
  note?: string;
  /**
   * full: every row every run (small / frequently edited tables, prunes rows
   * missing from the source). incremental: rows with watermark > last run.
   */
  mode: 'full' | 'incremental';
  /** Column used as the incremental watermark. Default "updatedAt". */
  watermarkColumn?: string;
  /** Optional SQL predicate on the source rows (no leading WHERE). */
  where?: string;
  /** Column rules. Unlisted text/json columns go through the generic scrubber. */
  columns: Record<string, ColumnRule>;
  /** Resolve the person this row is about (drives name/email/text rules). */
  person?: (row: Row, people: PeopleDirectory) => PersonRef | null | undefined;
  /** Resolve the staff member this row is about. */
  staff?: (row: Row, people: PeopleDirectory) => StaffRef | null | undefined;
  /** Extra name aliases for this row's text (beyond person + staff). */
  extraNames?: (row: Row, people: PeopleDirectory) => NameAlias[];
  /** Delete target rows missing from the source (full mode, or full runs). */
  prune?: boolean;
  /**
   * SQL predicate on TARGET rows that must never be pruned (demo-native rows
   * such as live-lane threads). May reference $1 = text[] of live phoneNumberIds
   * and $2 = text[] of protected user ids.
   */
  pruneExcludeSql?: string;
  /**
   * Company content (knowledge base, templates, quick replies) is never about
   * one person; skip the global name index there so junk lead names that
   * happen to be ordinary words cannot rewrite it.
   */
  skipNameIndex?: boolean;
  /** Rows per upsert statement. */
  batchSize?: number;
  /** Rows per source fetch. */
  fetchSize?: number;
}

export interface SyncOptions {
  /** Force full mode on every table (initial load / periodic reset). */
  full?: boolean;
  /** Only these tables (schema.table). */
  tables?: string[];
  /** Cap rows per table (smoke tests). */
  limit?: number;
  /** Dry run: read + mask, write nothing. */
  dryRun?: boolean;
  /** phoneNumberIds of the live-lane channels (rows under them are never pruned). */
  livePhoneNumberIds: string[];
  /** UserAccount ids that must survive pruning (demo logins). */
  protectedUserIds: string[];
  log?: (msg: string) => void;
}

export interface TableResult {
  table: string;
  mode: 'full' | 'incremental';
  read: number;
  written: number;
  pruned: number;
  skipped: number;
  ms: number;
  error?: string;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  full: boolean;
  tables: TableResult[];
  ok: boolean;
}
