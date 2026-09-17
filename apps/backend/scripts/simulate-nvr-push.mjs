#!/usr/bin/env node
/**
 * Simulate a Hikvision NVR face-capture push, so the whole attendance pipeline
 * can be exercised without the recorder being present.
 *
 * It sends exactly what the NVR sends: a multipart/form-data body with an
 * EventNotificationAlert XML part plus a binary JPEG part, POSTed to
 * /hik/<secret>. That is the same shape the parser is unit-tested against.
 *
 * Usage:
 *   node scripts/simulate-nvr-push.mjs --photo ./face.jpg
 *   node scripts/simulate-nvr-push.mjs --photo ./face.jpg \
 *        --url http://localhost:3001 --secret mysecret --channel 1
 *
 * Env fallbacks: BACKEND_URL, HIK_INGEST_SECRET
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const BASE = (args.url || process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
const SECRET = args.secret || process.env.HIK_INGEST_SECRET;
const CHANNEL = args.channel || '1';
const PHOTO = args.photo;

if (!SECRET) {
  console.error('Missing secret. Pass --secret <value> or set HIK_INGEST_SECRET.');
  process.exit(1);
}
if (!PHOTO) {
  console.error('Missing photo. Pass --photo ./face.jpg (a clear face shot).');
  process.exit(1);
}

const jpeg = readFileSync(PHOTO);
const uuid = randomUUID();
// The NVR sends local wall-clock time with an offset. PKT = +05:00.
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T` +
  `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}+05:00`;

const alert = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <ipAddress>192.168.1.64</ipAddress>
  <macAddress>ac:cb:51:aa:bb:cc</macAddress>
  <channelID>${CHANNEL}</channelID>
  <dateTime>${local}</dateTime>
  <activePostCount>1</activePostCount>
  <eventType>faceCapture</eventType>
  <eventState>active</eventState>
  <eventDescription>Face Capture</eventDescription>
  <uuid>${uuid}</uuid>
</EventNotificationAlert>`;

const boundary = '----HikvisionBoundary' + Math.random().toString(16).slice(2);
const CRLF = '\r\n';

// Built as raw Buffers, not a string, so the JPEG bytes are not mangled.
const body = Buffer.concat([
  Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="Event_Type"${CRLF}` +
    `Content-Type: application/xml${CRLF}${CRLF}`,
  ),
  Buffer.from(alert, 'utf8'),
  Buffer.from(
    `${CRLF}--${boundary}${CRLF}` +
    // Note: no filename — the NVR often omits it, which is why the backend
    // classifies parts by Content-Type rather than trusting a multipart lib.
    `Content-Disposition: form-data; name="Picture"${CRLF}` +
    `Content-Type: image/jpeg${CRLF}${CRLF}`,
  ),
  jpeg,
  Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
]);

const url = `${BASE}/hik/${SECRET}`;
console.log(`POST ${url}`);
console.log(`  channel   : ${CHANNEL}`);
console.log(`  event uuid: ${uuid}`);
console.log(`  photo     : ${PHOTO} (${jpeg.length} bytes)`);
console.log(`  body      : ${body.length} bytes`);

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  body,
});
const text = await res.text();
console.log(`\n<- HTTP ${res.status} ${text.trim()}`);

if (res.status === 200 && text.trim() === 'OK') {
  console.log('\nAccepted. The backend always replies OK so the NVR never retry-storms,');
  console.log('so check the result rather than trusting this response:');
  console.log('  GET /attendance/face/channels    -> the channel should now be listed');
  console.log('  the capture row should go PENDING -> MATCHED (or UNMATCHED)');
  console.log('  a MATCHED capture creates an attendance punch (source = NVR)');
} else {
  console.log('\nNot accepted — check the secret in the URL path and that the');
  console.log('backend mounted the raw-body parser for /hik.');
}
