/**
 * One-shot agreement-template body update — same effect as an admin editing
 * the template in the UI. Reads the new bodyHtml from a file and writes it to
 * the given template id. Prints a short before/after length so the change is
 * auditable without echoing the whole document.
 *
 * Run: railway run --service backend -- node scripts/update-agreement-template.js <templateId> <htmlFile>
 */
const { readFileSync } = require('node:fs');

// Deployed app monopolizes the session pooler — use the transaction pooler.
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}

const { PrismaClient } = require('@prisma/client');

async function main() {
  const [id, file] = process.argv.slice(2);
  if (!id || !file) throw new Error('usage: update-agreement-template.js <templateId> <htmlFile>');
  const bodyHtml = readFileSync(file, 'utf-8').trim();
  if (!bodyHtml.includes('{{PAYMENT_PLAN}}')) {
    throw new Error('refusing: new body is missing the {{PAYMENT_PLAN}} slot');
  }

  const prisma = new PrismaClient();
  const before = await prisma.agreementTemplate.findUniqueOrThrow({
    where: { id },
    select: { categoryKey: true, name: true, bodyHtml: true },
  });
  const after = await prisma.agreementTemplate.update({
    where: { id },
    data: { bodyHtml },
    select: { categoryKey: true, updatedAt: true },
  });
  console.log(
    `updated ${before.categoryKey} (${before.name}): bodyHtml ${before.bodyHtml.length} -> ${bodyHtml.length} chars, updatedAt=${after.updatedAt.toISOString()}`,
  );
  await prisma.$disconnect();
}

void main();
