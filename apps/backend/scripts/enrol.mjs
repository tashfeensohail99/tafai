#!/usr/bin/env node
/**
 * Enrol a person's face from photo files, without needing the admin UI.
 *
 *   node scripts/enrol.mjs --name "Ahmed" ./a1.jpg ./a2.jpg ./a3.jpg
 *   node scripts/enrol.mjs --list
 *   node scripts/enrol.mjs --employee <id> ./photo.jpg
 *   node scripts/enrol.mjs --test ./someone.jpg      # who is this? (no punch)
 *
 * Env / flags:
 *   --url    backend base   (default http://localhost:3001)
 *   --email  login email    (default admin@tashfeen.com)
 *   --pass   login password (default Admin@123456)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);

const BASE = (flag('url', 'http://localhost:3001')).replace(/\/$/, '');
const EMAIL = flag('email', 'admin@tashfeen.com');
const PASS = flag('pass', 'Admin@123456');

// Positional args = photo paths (anything not a flag or a flag's value)
const flagNames = ['url', 'email', 'pass', 'name', 'employee'];
const consumed = new Set();
for (const f of flagNames) {
  const i = argv.indexOf(`--${f}`);
  if (i >= 0) { consumed.add(i); consumed.add(i + 1); }
}
argv.forEach((a, i) => { if (a.startsWith('--')) consumed.add(i); });
const photos = argv.filter((_, i) => !consumed.has(i));

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (!r.ok) throw new Error(`login failed: HTTP ${r.status}`);
  const j = await r.json();
  if (!j.accessToken) throw new Error('login returned no token');
  return j.accessToken;
}

async function employees(token) {
  const r = await fetch(`${BASE}/employees`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  return Array.isArray(d) ? d : d.data ?? [];
}

function form(fields, file) {
  // Hand-built multipart so there is no extra dependency.
  const boundary = '----enrol' + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
    ));
  }
  if (file) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${basename(file.path)}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
    ));
    chunks.push(file.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), boundary };
}

const token = await login();

if (has('list')) {
  const emps = await employees(token);
  console.log(`\n  ${emps.length} employee(s):\n`);
  for (const e of emps) {
    console.log(`  ${e.id}  ${e.firstName} ${e.lastName}  [${e.employeeCode ?? '-'}]`);
  }
  console.log();
  process.exit(0);
}

if (has('test')) {
  if (!photos.length) { console.error('give me a photo to test'); process.exit(1); }
  const data = readFileSync(photos[0]);
  const { body, boundary } = form({}, { path: photos[0], data });
  const r = await fetch(`${BASE}/attendance/face/identify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const j = await r.json();
  if (j.matched) {
    const good = j.similarity >= 0.5;
    console.log(`\n  MATCH: ${j.name} (${j.code})  similarity ${j.similarity}`);
    console.log(good
      ? '  Confident.\n'
      : '  Weak (<0.50) — re-take the enrolment photos with better light.\n');
  } else {
    console.log('\n  NO MATCH — this person is not enrolled, or the photo is poor.\n');
  }
  process.exit(0);
}

// --- enrol ---
if (!photos.length) {
  console.error('Give me at least one photo. Try --list, or see the header for usage.');
  process.exit(1);
}

let employeeId = flag('employee');
const name = flag('name');

if (!employeeId) {
  if (!name) { console.error('Pass --name "Firstname" or --employee <id>. Use --list to see everyone.'); process.exit(1); }
  const emps = await employees(token);
  const needle = name.toLowerCase();
  const hits = emps.filter((e) =>
    `${e.firstName} ${e.lastName}`.toLowerCase().includes(needle),
  );
  if (hits.length === 0) { console.error(`No employee matching "${name}". Use --list.`); process.exit(1); }
  if (hits.length > 1) {
    console.error(`"${name}" is ambiguous:`);
    for (const h of hits) console.error(`  ${h.id}  ${h.firstName} ${h.lastName}`);
    process.exit(1);
  }
  employeeId = hits[0].id;
  console.log(`\n  enrolling: ${hits[0].firstName} ${hits[0].lastName}`);
}

let ok = 0;
for (const p of photos) {
  const data = readFileSync(p);
  const { body, boundary } = form({ employeeId }, { path: p, data });
  const r = await fetch(`${BASE}/attendance/face/enroll`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const txt = await r.text();
  if (r.ok) {
    const j = JSON.parse(txt);
    ok++;
    console.log(`  ok  ${basename(p)}  (${j.samples} sample${j.samples === 1 ? '' : 's'} total)`);
  } else {
    console.log(`  FAILED  ${basename(p)}  HTTP ${r.status}  ${txt.slice(0, 160)}`);
  }
}

console.log(`\n  enrolled ${ok}/${photos.length} photo(s).`);
console.log('  Verify with:  node scripts/enrol.mjs --test <another-photo-of-them>\n');
