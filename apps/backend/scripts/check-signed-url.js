/**
 * What Content-Type does Meta actually receive when it fetches our signed
 * voice-note link? Signs the most recent hosted .ogg the same way the
 * outbound worker does and HEAD-fetches it. If this returns octet-stream
 * (not audio/ogg), that's the 131053 cause for the link path.
 *
 * Run: railway run --service backend -- node scripts/check-signed-url.js
 */
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}
const { PrismaClient } = require('@prisma/client');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

async function main() {
  const prisma = new PrismaClient();
  const m = await prisma.whatsAppMessage.findFirst({
    where: { type: 'AUDIO', direction: 'OUTBOUND', mediaUrl: { startsWith: 'whatsapp/outbound/' } },
    orderBy: { createdAt: 'desc' },
    select: { mediaUrl: true },
  });
  await prisma.$disconnect();
  if (!m?.mediaUrl) { console.log('no hosted voice note'); return; }

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
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: m.mediaUrl }), { expiresIn: 300 });
  console.log('SIGNED URL host:', new URL(url).host);

  const res = await fetch(url, { method: 'GET' });
  console.log(`FETCH status=${res.status} content-type=${res.headers.get('content-type')} content-length=${res.headers.get('content-length')}`);
}
void main();
