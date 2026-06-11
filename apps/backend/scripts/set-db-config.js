/**
 * One-off prod config fix (2026-06-11): the app's DATABASE_URL pinned
 * connection_limit=15 on the SESSION pooler — the pooler's entire pool — so
 * any second client (prisma migrate, ops scripts) hit EMAXCONNSESSION.
 *
 * New layout (the standard Supabase+Prisma split):
 *   DATABASE_URL  → transaction pooler :6543, pgbouncer=true,
 *                   connection_limit=15 (kept at 15 — it was raised for
 *                   inbox speed; multiplexed, so it can't exhaust sessions
 *                   even when two containers overlap during a deploy)
 *   DIRECT_URL    → session pooler :5432 (unchanged) — now free for
 *                   migrations since the app no longer occupies it.
 *
 * Reads the current value from env (provided by `railway run`), rewrites it,
 * and sets it via the railway CLI. Prints ONLY masked hosts — never secrets.
 */
const { execSync } = require('node:child_process');

const cur = process.env.DATABASE_URL;
if (!cur) throw new Error('DATABASE_URL not in env');

const u = new URL(cur);
if (u.port === '6543') {
  console.log('DATABASE_URL already on transaction pooler — nothing to do.');
  process.exit(0);
}
u.port = '6543';
u.search = '?pgbouncer=true&connection_limit=15';

// Through the shell: Node on Windows refuses to spawn .cmd shims directly
// (EINVAL), and a failed spawn would dump the secret-bearing argv. Quotes
// keep the &-joined query params as one argument.
execSync(
  `railway variables --set "DATABASE_URL=${u.toString()}" --service backend --skip-deploys`,
  { stdio: ['ignore', 'ignore', 'inherit'] }, // swallow stdout (echoes values)
);
console.log(`DATABASE_URL updated: host=${u.hostname} port=${u.port} params=${u.search}`);
console.log('NOTE: set with --skip-deploys; trigger a redeploy to apply.');
