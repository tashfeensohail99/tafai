/**
 * Records a migration as applied in _prisma_migrations — equivalent to
 * `prisma migrate resolve --applied <name>`, but over the transaction-mode
 * pooler (the migrate engine needs a session slot, and the deployed app
 * monopolizes the session pool). Used once for 20260611210000_quick_replies,
 * whose DDL applied before the engine lost its connection.
 *
 * Usage: railway run --service backend -- npx ts-node -T scripts/resolve-migration.ts <migration_name>
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('migration name argument required');
  const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'));
  const checksum = createHash('sha256').update(sql).digest('hex');

  const prisma = new PrismaClient();
  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`,
    name,
  );
  if (existing.length > 0) {
    console.log(`already recorded: ${name}`);
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
       VALUES ($1, $2, NOW(), $3, NULL, NOW(), 1)`,
      randomUUID(),
      checksum,
      name,
    );
    console.log(`recorded as applied: ${name}`);
  }
  await prisma.$disconnect();
}

void main();
