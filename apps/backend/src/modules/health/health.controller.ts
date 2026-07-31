import { Controller, Get } from '@nestjs/common';
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'tafsheen-backend',
      version: '1.0.0',
    };
  }

  /**
   * Measure the backend -> database round-trip from INSIDE the deployed
   * container. This is the number no laptop can produce: running the same probe
   * over `railway run` measures the operator's home link (~950ms observed) and
   * says nothing about production.
   *
   * Why it matters: an inbox open fans out to ~6-7 sequential statements whose
   * combined server-side execution time is ~1.4ms. If RTT is ~2ms that fan-out
   * is free, and the fix list is compression + query shape. If RTT is ~70ms
   * (backend and DB in different regions) the SAME screen pays ~450ms of pure
   * network that no index can remove, and co-locating the services becomes the
   * highest-value change available. A regional migration is too expensive to
   * spend on a guess.
   *
   * `SELECT 1` is deliberate: no planning, no rows, no buffers — what remains is
   * transport + pooler overhead. Serial (not parallel) so this measures latency
   * rather than throughput.
   */
  @Get('db-latency')
  async dbLatency() {
    const samples: number[] = [];
    // One untimed warm-up: the first query on a pooled connection can include
    // connection setup / TLS, which would skew p50 on an otherwise idle pool.
    await this.prisma.$queryRaw`SELECT 1`;

    for (let i = 0; i < 20; i++) {
      const started = process.hrtime.bigint();
      await this.prisma.$queryRaw`SELECT 1`;
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const pct = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      note: 'Backend->DB round-trip measured inside the container. SELECT 1 = transport + pooler only.',
      samples: samples.length,
      p50Ms: round(pct(50)),
      p95Ms: round(pct(95)),
      minMs: round(sorted[0]),
      maxMs: round(sorted[sorted.length - 1]),
      meanMs: round(samples.reduce((a, b) => a + b, 0) / samples.length),
      // A typical inbox open issues ~7 sequential statements; this is the pure
      // network floor that screen pays before any query work happens.
      estimatedInboxOpenNetworkFloorMs: round(pct(50) * 7),
    };
  }

  /**
   * Separate DISTANCE from ROUND-TRIP COUNT. This decides whether the fix is a
   * database migration or a connection-config change — a very expensive
   * difference to guess at.
   *
   * `SELECT 1` measures ~400-500ms in production, but Singapore (Railway) to
   * Seoul (Supabase, ap-northeast-2) should be only ~70-90ms. Something is
   * multiplying it ~5x. Two candidates, opposite fixes:
   *
   *   (a) genuine distance      -> a TCP handshake also costs ~400ms
   *                                => only co-location fixes it (migrate the DB).
   *   (b) too many round-trips  -> TCP handshake ~80ms, but each query costs 5x that
   *                                because connections are being re-established, or
   *                                the driver/pooler is not pipelining
   *                                => fixable in config. No migration needed.
   *
   * A bare TCP connect is exactly one round trip, so it is the cleanest possible
   * ruler for the real network distance. We then express the query cost as a
   * multiple of it.
   */
  @Get('net-latency')
  async netLatency() {
    const raw = process.env.DATABASE_URL ?? '';
    const m = raw.match(/@([^:/?]+):(\d+)/);
    if (!m) return { error: 'could not parse host:port from DATABASE_URL' };
    const host = m[1];
    const port = parseInt(m[2], 10);

    const timeOnce = (withTls: boolean) =>
      new Promise<number>((resolve, reject) => {
        const started = process.hrtime.bigint();
        const done = (sock: { destroy: () => void }) => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          sock.destroy();
          resolve(ms);
        };
        const sock = withTls
          ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false }, () => done(sock))
          : tcpConnect({ host, port }, () => done(sock));
        sock.setTimeout(10_000, () => {
          sock.destroy();
          reject(new Error('timeout'));
        });
        sock.on('error', (e) => {
          sock.destroy();
          reject(e);
        });
      });

    const sample = async (withTls: boolean) => {
      const out: number[] = [];
      for (let i = 0; i < 8; i++) {
        try {
          out.push(await timeOnce(withTls));
        } catch {
          /* skip failed probe */
        }
      }
      out.sort((a, b) => a - b);
      return out;
    };

    const tcp = await sample(false);
    const tls = await sample(true);

    // Query cost on an already-established pooled connection.
    await this.prisma.$queryRaw`SELECT 1`;
    const q: number[] = [];
    for (let i = 0; i < 10; i++) {
      const s = process.hrtime.bigint();
      await this.prisma.$queryRaw`SELECT 1`;
      q.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
    q.sort((a, b) => a - b);

    const med = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : NaN);
    const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

    const tcpMed = med(tcp);
    const queryMed = med(q);
    const ratio = Number.isFinite(tcpMed) && tcpMed > 0 ? queryMed / tcpMed : NaN;

    return {
      host,
      port,
      tcpHandshakeMs: { median: round(tcpMed), min: round(tcp[0]), samples: tcp.length },
      tlsHandshakeMs: { median: round(med(tls)), min: round(tls[0]), samples: tls.length },
      queryMs: { median: round(queryMed), min: round(q[0]) },
      // One TCP handshake == one network round trip. This is how many the driver
      // effectively spends per trivial query.
      queryCostInRoundTrips: round(ratio),
      interpretation:
        !Number.isFinite(ratio)
          ? 'probe failed'
          : ratio > 2.5
            ? 'TOO MANY ROUND-TRIPS: the network is not the whole story. Query costs >2.5 network round trips, so connection reuse / pooler config is inflating it. Likely fixable WITHOUT migrating the database.'
            : 'DISTANCE-BOUND: a query costs about one network round trip, so the latency is the physical distance. Co-locating the database is the only real fix.',
    };
  }
}
