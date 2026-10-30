/**
 * Integration test for the sync engine against a local Postgres.
 *
 * Creates two throwaway databases (source + target) with a MINI copy of the
 * production table shapes the rules reference, loads real-looking rows into
 * the source, runs the real DEMO_SYNC_RULES through the engine and checks:
 * masking, idempotency, incremental watermarks, pruning with live-lane
 * exclusions, and generated-column handling.
 *
 * Needs DEMO_TEST_PG_URL (default postgresql://postgres:postgres@localhost:5432/postgres).
 * Skips itself with a warning when that server is unreachable.
 */
import { Pool } from 'pg';
import { DEFAULT_MASKING_CONFIG, DemoMasker } from '../masking';
import { DemoSyncEngine, poolFromUrl } from './engine';
import { DEMO_SYNC_RULES, LOCKED_PASSWORD_HASH } from './rules';

const ADMIN_URL = process.env.DEMO_TEST_PG_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const SRC_DB = 'tafai_demo_sync_src_test';
const DST_DB = 'tafai_demo_sync_dst_test';

const SCHEMA_SQL = `
CREATE SCHEMA core; CREATE SCHEMA crm; CREATE SCHEMA whatsapp;
CREATE TABLE core.user_accounts (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, phone text UNIQUE, "passwordHash" text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE', "twoFactorEnabled" boolean NOT NULL DEFAULT false, "twoFactorSecret" text,
  "emailSignature" text, "failedLoginAttempts" int NOT NULL DEFAULT 0, "lockedUntil" timestamp(3), "mustChangePassword" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now(), "deletedAt" timestamp(3)
);
CREATE TABLE core.employees (
  id text PRIMARY KEY, "userId" text UNIQUE NOT NULL REFERENCES core.user_accounts(id), "firstName" text NOT NULL, "lastName" text NOT NULL,
  gender text, "dateOfBirth" timestamp(3), "nationalId" text, "passportNumber" text, "profilePhotoKey" text, "employeeCode" text UNIQUE,
  skills text[] NOT NULL DEFAULT '{}', "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE TABLE crm.leads (
  id text PRIMARY KEY, "referenceCode" text UNIQUE NOT NULL, "firstName" text NOT NULL, "lastName" text NOT NULL, email text, phone text NOT NULL,
  "alternatePhone" text, notes text, status text NOT NULL DEFAULT 'NEW', "emailVerificationToken" text UNIQUE, "metaLeadId" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE TABLE crm.clients (
  id text PRIMARY KEY, "referenceCode" text UNIQUE NOT NULL, "firstName" text NOT NULL, "lastName" text NOT NULL, email text UNIQUE, phone text UNIQUE,
  gender text, "dateOfBirth" timestamp(3), cnic text, "passportNumber" text, address text, "sourceLeadId" text, "payerClientId" text REFERENCES crm.clients(id),
  "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE TABLE whatsapp.channels (
  id text PRIMARY KEY, label text NOT NULL, "wabaId" text NOT NULL, "phoneNumberId" text UNIQUE NOT NULL, "displayNumber" text NOT NULL,
  "accessTokenEnc" text NOT NULL, "webhookVerifyToken" text, platform text NOT NULL DEFAULT 'WHATSAPP',
  "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE TABLE whatsapp.threads (
  id text PRIMARY KEY, "channelId" text NOT NULL REFERENCES whatsapp.channels(id), "leadId" text UNIQUE REFERENCES crm.leads(id), "clientId" text,
  "waContactId" text NOT NULL, platform text NOT NULL DEFAULT 'WHATSAPP', "lastMessagePreview" text, "adReferral" jsonb, "aiSummary" jsonb, "aiState" text NOT NULL DEFAULT 'INITIAL',
  "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now(), UNIQUE ("channelId", "waContactId")
);
CREATE TABLE whatsapp.messages (
  id text PRIMARY KEY, "threadId" text NOT NULL REFERENCES whatsapp.threads(id), "channelId" text NOT NULL, "leadId" text, "clientId" text,
  "waMessageId" text UNIQUE, "idempotencyKey" text UNIQUE, direction text NOT NULL, type text NOT NULL, status text NOT NULL DEFAULT 'RECEIVED',
  body text, payload jsonb, "mediaUrl" text, "mediaMimeType" text, "mediaSha256" text, "errorDetails" jsonb,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(), "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);
`;

const TABLES = ['core.user_accounts', 'core.employees', 'crm.leads', 'crm.clients', 'whatsapp.channels', 'whatsapp.threads', 'whatsapp.messages'];

let available = false;
let src: Pool;
let dst: Pool;
let engine: DemoSyncEngine;
const masker = new DemoMasker({ ...DEFAULT_MASKING_CONFIG, salt: 'engine-spec-salt-0123456789abcdef' });
const opts = { livePhoneNumberIds: ['LIVE-PNID'], protectedUserIds: ['user-demo-admin'], log: () => undefined };

async function recreate(admin: Pool, name: string): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1, connectionTimeoutMillis: 3000 });
  try {
    await admin.query('select 1');
  } catch (err) {
    console.warn(`[engine.spec] skipping: no Postgres at ${ADMIN_URL.replace(/:[^:@/]+@/, ':***@')} (${(err as Error).message})`);
    await admin.end();
    return;
  }
  await recreate(admin, SRC_DB);
  await recreate(admin, DST_DB);
  await admin.end();
  const base = ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, '');
  src = poolFromUrl(`${base}/${SRC_DB}`, { max: 2 });
  dst = poolFromUrl(`${base}/${DST_DB}`, { max: 2 });
  await src.query(SCHEMA_SQL);
  await dst.query(SCHEMA_SQL);
  // Target has a generated column the source lacks → must be skipped.
  await dst.query(`ALTER TABLE whatsapp.messages ADD COLUMN body_len int GENERATED ALWAYS AS (length(body)) STORED`);

  await src.query(`
    INSERT INTO core.user_accounts (id, email, phone, "passwordHash", "twoFactorEnabled", "twoFactorSecret", "emailSignature")
    VALUES ('user-1', 'tashfeen.sohail@tashfeengroup.com', '+923009998877', '$2b$12$realhashrealhashrealhashrealhashrealhashrealhashrealha', true, 'JBSWY3DPEHPK3PXP', 'Tashfeen Sohail · +92 300 9998877');
    INSERT INTO core.employees (id, "userId", "firstName", "lastName", gender, "dateOfBirth", "nationalId", "passportNumber", "profilePhotoKey", "employeeCode")
    VALUES ('emp-1', 'user-1', 'Tashfeen', 'Sohail', 'MALE', '1985-03-10', '35202-1234567-1', 'AB1234567', 'photos/emp-1.jpg', 'EMP-001');
    INSERT INTO crm.leads (id, "referenceCode", "firstName", "lastName", email, phone, "alternatePhone", notes, "emailVerificationToken", "metaLeadId", "updatedAt")
    VALUES
      ('lead-1', 'TIS-2026-00001', 'Muhammad Ali', 'Qadri', 'ali.qadri@gmail.com', '+923001234567', '03007654321', 'Ali Qadri wants Canada PR, call 0300-1234567, email ali.qadri@gmail.com', 'tok-1', '1234567890123456', now() - interval '1 day'),
      ('lead-gone', 'TIS-2026-00002', 'Gone', 'Person', NULL, '+923331112233', NULL, NULL, NULL, NULL, now() - interval '1 day'),
      ('lead-live', 'TIS-2026-00003', 'Live', 'Prospect', NULL, '+447700900123', NULL, NULL, NULL, NULL, now() - interval '1 day'),
      ('e349cd6b-153d-465e-ac78-09457552333a', 'TIS-2026-00004', 'Uuid', 'Digits', NULL, '+923215550001', NULL, 'ref 1234567890123 kept?', NULL, NULL, now() - interval '1 day');
    INSERT INTO crm.clients (id, "referenceCode", "firstName", "lastName", email, phone, gender, "dateOfBirth", cnic, "passportNumber", address, "sourceLeadId")
    VALUES ('client-1', 'TIS-2026-00001', 'Muhammad Ali', 'Qadri', 'ali.qadri@gmail.com', '+923001234567', 'MALE', '1990-06-15', '35202-7654321-9', 'CD7654321', 'House 5, Street 9, DHA Phase 5, Lahore', 'lead-1');
    INSERT INTO whatsapp.channels (id, label, "wabaId", "phoneNumberId", "displayNumber", "accessTokenEnc", "webhookVerifyToken")
    VALUES ('ch-prod', 'Tashfeen main line', 'WABA1', 'PROD-PNID', '+923111234567', 'iv:realciphertext:tag', 'verify-secret');
    INSERT INTO whatsapp.threads (id, "channelId", "leadId", "waContactId", "lastMessagePreview", "adReferral", "updatedAt")
    VALUES ('th-1', 'ch-prod', 'lead-1', '923001234567', 'Ali Qadri: call me on 03001234567', '{"source_url":"https://fb.com/ad","ctwa_clid":"abc123"}', now() - interval '1 day');
    INSERT INTO whatsapp.messages (id, "threadId", "channelId", "leadId", "waMessageId", "idempotencyKey", direction, type, body, payload, "mediaUrl", "mediaSha256", "createdAt", "updatedAt")
    VALUES
      ('m-1', 'th-1', 'ch-prod', 'lead-1', 'wamid.HBgMOTIzMDAxMjM0NTY3FQIAERgSMUFBQjQ4QzY1', NULL, 'INBOUND', 'TEXT',
       'Hi, this is Muhammad Ali Qadri, my CNIC is 35202-1234567-1 and number +92 300 1234567',
       '{"from":"923001234567","contacts":[{"profile":{"name":"Ali Qadri"},"wa_id":"923001234567"}],"text":{"body":"Hi, this is Muhammad Ali Qadri"}}',
       NULL, NULL, now() - interval '2 days', now() - interval '2 days'),
      ('m-2', 'th-1', 'ch-prod', 'lead-1', 'wamid.AUDIO1', 'idem-1', 'INBOUND', 'AUDIO',
       'Transcript: Ali here, call me back on 03001234567 please',
       '{"audio":{"id":"9999999999999999","mime_type":"audio/ogg; codecs=opus","voice":true}}',
       'whatsapp/media/m-2.ogg', 'deadbeef', now() - interval '2 days', now() - interval '2 days'),
      ('m-3', 'th-1', 'ch-prod', 'lead-1', 'wamid.IMG1', 'idem-2', 'OUTBOUND', 'IMAGE', NULL,
       '{"image":{"id":"8888888888888888","mime_type":"image/jpeg","caption":"Here is the brochure, Ali"}}',
       'meta:8888888888888888', NULL, now() - interval '2 days', now() - interval '2 days');
  `);

  // Demo-native rows in the TARGET that must survive pruning: a live-lane
  // channel with its thread + lead, and the demo admin login.
  await dst.query(`
    INSERT INTO core.user_accounts (id, email, "passwordHash") VALUES ('user-demo-admin', 'demo.admin@summit-demo.example', '$2b$12$demo');
    INSERT INTO whatsapp.channels (id, label, "wabaId", "phoneNumberId", "displayNumber", "accessTokenEnc")
    VALUES ('ch-live', 'Demo live lane', 'WABA-DEMO', 'LIVE-PNID', '+15550001111', 'iv:demo:tag');
    INSERT INTO crm.leads (id, "referenceCode", "firstName", "lastName", phone) VALUES ('lead-prospect', 'DEMO-0001', 'Real', 'Prospect', '+15551234567');
    INSERT INTO whatsapp.threads (id, "channelId", "leadId", "waContactId") VALUES ('th-live', 'ch-live', 'lead-prospect', '15551234567');
    INSERT INTO whatsapp.messages (id, "threadId", "channelId", "leadId", direction, type, body) VALUES ('m-live', 'th-live', 'ch-live', 'lead-prospect', 'INBOUND', 'TEXT', 'hello from a prospect');
  `);

  engine = new DemoSyncEngine(src, dst, masker, DEMO_SYNC_RULES);
  available = true;
}, 60_000);

afterAll(async () => {
  await src?.end();
  await dst?.end();
});

const skipIfUnavailable = () => {
  if (!available) {
    console.warn('[engine.spec] test skipped (no database)');
    return true;
  }
  return false;
};

describe('DemoSyncEngine (integration)', () => {
  it('copies and masks every table, keeps structure, locks staff logins', async () => {
    if (skipIfUnavailable()) return;
    const res = await engine.run({ ...opts, full: true, tables: TABLES });
    expect(res.tables.filter((t) => t.error).map((t) => `${t.table}: ${t.error}`)).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.tables.find((t) => t.table === 'whatsapp.messages')!.written).toBe(3);

    const lead = (await dst.query(`SELECT * FROM crm.leads WHERE id = 'lead-1'`)).rows[0];
    expect(lead.firstName).not.toBe('Muhammad Ali');
    expect(lead.lastName).not.toBe('Qadri');
    expect(lead.phone).toMatch(/^\+923\d{9}$/);
    expect(lead.phone).not.toBe('+923001234567');
    expect(lead.alternatePhone).toMatch(/^03\d{9}$/);
    expect(lead.email).toMatch(/@summit-demo\.example$/);
    expect(lead.notes).not.toMatch(/Qadri|1234567|gmail/);
    expect(lead.notes).toContain(`${lead.firstName} ${lead.lastName}`);
    expect(lead.emailVerificationToken).toBeNull();
    expect(lead.metaLeadId).toMatch(/^demo-metaLeadId-/);
    expect(lead.referenceCode).toBe('TIS-2026-00001');

    // Converted client shares the lead's fake identity and phone.
    const client = (await dst.query(`SELECT * FROM crm.clients WHERE id = 'client-1'`)).rows[0];
    expect(client.firstName).toBe(lead.firstName);
    expect(client.lastName).toBe(lead.lastName);
    expect(client.phone).toBe(lead.phone);
    expect(client.cnic).toMatch(/^\d{5}-\d{7}-\d$/);
    expect(client.cnic).not.toBe('35202-7654321-9');
    expect(client.passportNumber).toMatch(/^P\d{7}$/);
    expect(client.address).not.toMatch(/DHA/);
    expect(String(client.dateOfBirth)).not.toBe('1990-06-15 00:00:00');

    // Thread contact id equals the lead's fake E.164 digits (routing still works).
    const thread = (await dst.query(`SELECT * FROM whatsapp.threads WHERE id = 'th-1'`)).rows[0];
    expect(`+${thread.waContactId}`).toBe(lead.phone);
    expect(thread.lastMessagePreview).not.toMatch(/Qadri|1234567/);
    expect(JSON.stringify(thread.adReferral)).not.toMatch(/abc123/);

    // Messages: text scrubbed, payload media stripped, media placeholder, wamid replaced.
    const msgs = (await dst.query(`SELECT * FROM whatsapp.messages WHERE "threadId" = 'th-1' ORDER BY id`)).rows;
    const m1 = msgs.find((m) => m.id === 'm-1')!;
    expect(m1.body).not.toMatch(/Qadri|Muhammad|35202|1234567/);
    expect(m1.body).toContain(lead.firstName);
    expect(m1.waMessageId).toMatch(/^wamid\.demo[0-9a-f]{32}$/);
    expect(m1.payload.from).toBe(thread.waContactId);
    expect(m1.payload.contacts[0].profile.name).toBe(lead.firstName);
    const m2 = msgs.find((m) => m.id === 'm-2')!;
    expect(m2.mediaUrl).toBe('demo:placeholder');
    expect(m2.mediaSha256).toBeNull();
    expect(m2.body).toMatch(/Transcript/);
    expect(m2.body).not.toMatch(/1234567/);
    expect(m2.payload.audio.id).toBeUndefined();
    expect(m2.payload.audio.voice).toBe(true);
    expect(m2.idempotencyKey).toMatch(/^demo-idempotencyKey-/);
    const m3 = msgs.find((m) => m.id === 'm-3')!;
    expect(m3.mediaUrl).toBe('demo:placeholder');
    expect(m3.payload.image.id).toBeUndefined();
    expect(m3.payload.image.caption).not.toMatch(/\bAli\b/);

    // Staff: aliased, login locked, 2FA stripped, photo removed.
    const user = (await dst.query(`SELECT * FROM core.user_accounts WHERE id = 'user-1'`)).rows[0];
    expect(user.email).toMatch(/@summit-demo\.example$/);
    expect(user.passwordHash).toBe(LOCKED_PASSWORD_HASH);
    expect(user.twoFactorEnabled).toBe(false);
    expect(user.twoFactorSecret).toBeNull();
    expect(user.emailSignature).not.toMatch(/Tashfeen|9998877/);
    const emp = (await dst.query(`SELECT * FROM core.employees WHERE id = 'emp-1'`)).rows[0];
    expect(emp.firstName).not.toBe('Tashfeen');
    expect(emp.profilePhotoKey).toBeNull();
    expect(emp.nationalId).not.toBe('35202-1234567-1');
    // Staff name inside the lead's thread text is aliased too.
    expect(user.emailSignature).toContain(emp.firstName);

    // Channel token never copied.
    const ch = (await dst.query(`SELECT * FROM whatsapp.channels WHERE id = 'ch-prod'`)).rows[0];
    expect(ch.accessTokenEnc).toBe('demo:blocked');
    expect(ch.webhookVerifyToken).toBeNull();
    expect(ch.label).not.toMatch(/Tashfeen/);

    // Pruning: source-deleted rows go, live-lane + protected rows stay.
    await src.query(`DELETE FROM crm.leads WHERE id = 'lead-gone'`);
    const res2 = await engine.run({ ...opts, full: true, tables: TABLES });
    expect(res2.ok).toBe(true);
    const ids = (await dst.query(`SELECT id FROM crm.leads ORDER BY id`)).rows.map((r) => r.id);
    // A UUID with a 10+ digit run must survive untouched (ids are never scrubbed).
    expect(ids).toEqual(['e349cd6b-153d-465e-ac78-09457552333a', 'lead-1', 'lead-live', 'lead-prospect']);
    const uuidLead = (await dst.query(`SELECT notes FROM crm.leads WHERE id = 'e349cd6b-153d-465e-ac78-09457552333a'`)).rows[0];
    expect(uuidLead.notes).not.toContain('1234567890123'); // but digit runs in prose are still masked
    expect((await dst.query(`SELECT count(*)::int AS n FROM whatsapp.threads WHERE id = 'th-live'`)).rows[0].n).toBe(1);
    expect((await dst.query(`SELECT count(*)::int AS n FROM whatsapp.messages WHERE id = 'm-live'`)).rows[0].n).toBe(1);
    expect((await dst.query(`SELECT count(*)::int AS n FROM whatsapp.channels WHERE id = 'ch-live'`)).rows[0].n).toBe(1);
    expect((await dst.query(`SELECT count(*)::int AS n FROM core.user_accounts WHERE id = 'user-demo-admin'`)).rows[0].n).toBe(1);
  }, 60_000);

  it('is idempotent (unchanged rows are not rewritten) and self-heals prospect edits', async () => {
    if (skipIfUnavailable()) return;
    await engine.run({ ...opts, full: true, tables: TABLES });
    const before = (await dst.query(`SELECT xmin::text AS x FROM crm.leads WHERE id = 'lead-1'`)).rows[0].x;
    await engine.run({ ...opts, full: true, tables: TABLES });
    const after = (await dst.query(`SELECT xmin::text AS x FROM crm.leads WHERE id = 'lead-1'`)).rows[0].x;
    expect(after).toBe(before); // IS DISTINCT FROM guard skipped the update

    await dst.query(`UPDATE crm.leads SET notes = 'prospect typed something here' WHERE id = 'lead-1'`);
    await engine.run({ ...opts, full: true, tables: TABLES });
    const notes = (await dst.query(`SELECT notes FROM crm.leads WHERE id = 'lead-1'`)).rows[0].notes;
    expect(notes).not.toBe('prospect typed something here');
  }, 60_000);

  it('incremental runs pick up only new/changed source rows and keep the watermark', async () => {
    if (skipIfUnavailable()) return;
    await engine.run({ ...opts, full: true, tables: TABLES });
    await src.query(`
      INSERT INTO whatsapp.messages (id, "threadId", "channelId", "leadId", direction, type, body, "createdAt", "updatedAt")
      VALUES ('m-4', 'th-1', 'ch-prod', 'lead-1', 'OUTBOUND', 'TEXT', 'Thanks Ali Qadri, see you at 3pm — Tashfeen Immigration Solutions', now(), now())`);
    const res = await engine.run({ ...opts, full: false, tables: ['whatsapp.messages'] });
    const t = res.tables[0];
    expect(t.mode).toBe('incremental');
    expect(t.read).toBeGreaterThanOrEqual(1);
    const m4 = (await dst.query(`SELECT body FROM whatsapp.messages WHERE id = 'm-4'`)).rows[0];
    expect(m4.body).not.toMatch(/Qadri|Tashfeen/);
    expect(m4.body).toMatch(/Summit Immigration Consultants/);
    const state = (await dst.query(`SELECT watermark FROM demo_sync.state WHERE "table" = 'whatsapp.messages'`)).rows[0];
    expect(state.watermark).toBeTruthy();
    // Generated column on the target was skipped but still computed.
    const gen = (await dst.query(`SELECT body_len FROM whatsapp.messages WHERE id = 'm-4'`)).rows[0];
    expect(gen.body_len).toBe(m4.body.length);
  }, 60_000);

  it('dry run writes nothing', async () => {
    if (skipIfUnavailable()) return;
    await src.query(`INSERT INTO crm.leads (id, "referenceCode", "firstName", "lastName", phone) VALUES ('lead-dry', 'TIS-2026-00099', 'Dry', 'Run', '+923219876543')`);
    const res = await engine.run({ ...opts, full: true, dryRun: true, tables: ['crm.leads'] });
    expect(res.tables[0].read).toBeGreaterThan(0);
    expect((await dst.query(`SELECT count(*)::int AS n FROM crm.leads WHERE id = 'lead-dry'`)).rows[0].n).toBe(0);
    await src.query(`DELETE FROM crm.leads WHERE id = 'lead-dry'`);
  }, 60_000);
});
