import { Controller, Get } from '@nestjs/common';
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
}
