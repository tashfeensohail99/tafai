/**
 * Read-only diagnostic for the voice-note 131053 issue:
 *  1. Are there ANY delivered/read AUDIO messages system-wide (does web
 *     really work)?
 *  2. Download the bytes of the most recent hosted (link-path) voice note
 *     from storage and inspect the container (OggS / OpusHead / size).
 *
 * Run: railway run --service backend -- node scripts/inspect-audio-bytes.js
 */
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  const delivered = await prisma.whatsAppMessage.count({
    where: { type: 'AUDIO', direction: 'OUTBOUND', status: { in: ['DELIVERED', 'READ'] } },
  });
  const failed = await prisma.whatsAppMessage.count({
    where: { type: 'AUDIO', direction: 'OUTBOUND', status: 'FAILED' },
  });
  console.log(`OUTBOUND AUDIO system-wide: delivered/read=${delivered}, failed=${failed}`);

  // Most recent hosted (storage-key) voice note — its bytes are in our bucket.
  const recent = await prisma.whatsAppMessage.findFirst({
    where: {
      type: 'AUDIO',
      direction: 'OUTBOUND',
      mediaUrl: { startsWith: 'whatsapp/outbound/' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, mediaUrl: true, mediaMimeType: true, status: true },
  });
  console.log('recent hosted voice note:', JSON.stringify(recent));

  // A Meta-origin inbound voice note (definitely Meta-spec) to compare against.
  const inbound = await prisma.whatsAppMessage.findFirst({
    where: { type: 'AUDIO', direction: 'INBOUND', mediaUrl: { startsWith: 'whatsapp/media/' } },
    orderBy: { createdAt: 'desc' },
    select: { mediaUrl: true },
  });
  console.log('inbound sample key:', inbound?.mediaUrl);
  await prisma.$disconnect();

  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
    },
    forcePathStyle: true,
  });
  const bucket = process.env.STORAGE_BUCKET ?? 'receipts';
  async function grab(key, label) {
    if (!key) return;
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = [];
    for await (const c of out.Body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks);
    const opusAt = b.indexOf(Buffer.from('OpusHead'));
    let ch = '?', rate = '?';
    if (opusAt >= 0) {
      ch = b.readUInt8(opusAt + 9);
      rate = b.readUInt32LE(opusAt + 12);
    }
    console.log(`${label}: ${b.length}B | ct=${out.ContentType} | magic="${b.subarray(0,4).toString('latin1')}" | channels=${ch} | inputRate=${rate}`);
  }
  await grab(recent?.mediaUrl, 'OUR FAILING ogg');
  await grab(inbound?.mediaUrl, 'META INBOUND ogg');
  return;

  if (recent?.mediaUrl) {
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
      },
      forcePathStyle: true,
    });
    const bucket = process.env.STORAGE_BUCKET ?? 'receipts';
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: recent.mediaUrl }));
    const chunks = [];
    for await (const c of out.Body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const bytes = Buffer.concat(chunks);
    const head = bytes.subarray(0, 4).toString('latin1');
    const opusAt = bytes.indexOf(Buffer.from('OpusHead'));
    console.log(
      `BYTES: ${bytes.length} | s3ContentType=${out.ContentType} | magic="${head}" | OpusHead@${opusAt}`,
    );
    console.log('first 48 bytes hex:', bytes.subarray(0, 48).toString('hex'));
  }
}
void main();
