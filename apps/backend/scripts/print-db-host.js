// Masked dump of which hosts DATABASE_URL / DIRECT_URL point at, so we can
// tell pooler (pgbouncer, limited session slots) from the direct Postgres host.
for (const k of ['DATABASE_URL', 'DIRECT_URL']) {
  const v = process.env[k];
  if (!v) {
    console.log(`${k}: <unset>`);
    continue;
  }
  try {
    const u = new URL(v);
    console.log(`${k}: host=${u.hostname} port=${u.port} params=${u.search}`);
  } catch {
    console.log(`${k}: <unparseable>`);
  }
}
