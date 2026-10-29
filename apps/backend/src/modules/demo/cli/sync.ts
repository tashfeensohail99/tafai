/**
 * On-demand production → demo sync.
 *
 *   npm run demo:sync -- --full            # full copy + prune (first load / reset)
 *   npm run demo:sync                      # incremental
 *   npm run demo:sync -- --tables crm.leads,whatsapp.threads --limit 200 --dry-run
 *
 * Env: DEMO_SYNC_SOURCE_DATABASE_URL (read-only prod role), DATABASE_URL or
 * DEMO_SYNC_TARGET_DATABASE_URL (demo DB), DEMO_MASK_SALT, DEMO_LIVE_PHONE_NUMBER_IDS.
 * In the container: node dist/modules/demo/cli/sync.js --full
 */
import { demoLivePhoneNumberIds } from '../../../common/demo-mode';
import { protectedUserIds } from '../demo.constants';
import { maskerFromEnv } from '../masking';
import { DemoSyncEngine, poolFromUrl } from '../sync/engine';
import { DEMO_SYNC_RULES } from '../sync/rules';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

async function main(): Promise<void> {
  const sourceUrl = process.env.DEMO_SYNC_SOURCE_DATABASE_URL;
  const targetUrl = process.env.DEMO_SYNC_TARGET_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DEMO_SYNC_SOURCE_DATABASE_URL is not set');
  if (!targetUrl) throw new Error('DATABASE_URL / DEMO_SYNC_TARGET_DATABASE_URL is not set');
  if (sourceUrl === targetUrl) throw new Error('source and target are the same database — refusing');

  const source = poolFromUrl(sourceUrl, { max: 3, readOnly: true, statementTimeoutMs: 600_000 });
  const target = poolFromUrl(targetUrl, { max: 4 });
  const engine = new DemoSyncEngine(source, target, maskerFromEnv(), DEMO_SYNC_RULES);
  const tables = arg('tables')?.split(',').map((s) => s.trim()).filter(Boolean);
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const res = await engine.run({
    full: arg('full') === 'true',
    dryRun: arg('dry-run') === 'true',
    tables: tables?.length ? tables : undefined,
    limit,
    livePhoneNumberIds: demoLivePhoneNumberIds(),
    protectedUserIds: protectedUserIds(),
    log: (m) => console.log(`[sync] ${m}`),
  });
  await source.end();
  await target.end();
  const totals = res.tables.reduce((a, t) => ({ read: a.read + t.read, written: a.written + t.written, pruned: a.pruned + t.pruned, skipped: a.skipped + t.skipped }), { read: 0, written: 0, pruned: 0, skipped: 0 });
  console.log(`\n${res.ok ? 'OK' : 'ERRORS'} ${res.full ? 'full' : 'incremental'} read=${totals.read} written=${totals.written} pruned=${totals.pruned} skipped=${totals.skipped} (${new Date(res.finishedAt).getTime() - new Date(res.startedAt).getTime()}ms)`);
  for (const t of res.tables.filter((x) => x.error)) console.error(`  ${t.table}: ${t.error}`);
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
