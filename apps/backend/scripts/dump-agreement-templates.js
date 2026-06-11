/**
 * Read-only dump of agreement templates (id, category, title + bodyHtml) so a
 * template can be compared/edited offline. Writes bodyHtml files next to this
 * script as template-<categoryKey>.html.
 *
 * Run: railway run --service backend -- node scripts/dump-agreement-templates.js
 */
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Deployed app monopolizes the session pooler — use the transaction pooler.
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const templates = await prisma.agreementTemplate.findMany({
    select: {
      id: true,
      categoryKey: true,
      name: true,
      programTitle: true,
      isActive: true,
      bodyHtml: true,
      updatedAt: true,
    },
    orderBy: { categoryKey: 'asc' },
  });
  for (const t of templates) {
    console.log(
      `${t.id} | ${t.categoryKey} | active=${t.isActive} | ${t.name} | ${t.programTitle} | updated=${t.updatedAt.toISOString()}`,
    );
    writeFileSync(join(__dirname, `template-${t.categoryKey}-${t.id.slice(0, 8)}.html`), t.bodyHtml);
  }
  console.log(`\n${templates.length} templates dumped beside this script.`);
  await prisma.$disconnect();
}

void main();
