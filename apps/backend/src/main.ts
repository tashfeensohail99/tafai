// build-stamp: 2026-05-12T10:26:52.442Z
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, raw } from 'express';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // We run behind Railway's edge proxy, so the socket peer is the proxy, not
  // the caller. Without this, `req.ip` is a Railway address that CHANGES from
  // request to request — which silently defeated the rate limiter on
  // POST /public/leads/website: every request got its own bucket, so the
  // 5/min cap never tripped (verified in production: 7 rapid posts, 7×201,
  // with x-ratelimit-remaining stuck at 4).
  //
  // The hop count matters, and it must EQUAL the number of proxies in front of
  // us. Trusting the whole chain (`true`) would take the LEFTMOST,
  // caller-supplied entry and hand any script a free throttle bypass. Trusting
  // too FEW is just as wrong in the other direction: it yields one of our own
  // proxies, identical for every caller.
  //
  // MEASURED on production 2026-08-07 (one real request, logged end to end):
  //   X-Forwarded-For: <caller> -> 152.233.15.120
  //   socket.remoteAddress: 100.64.0.8
  // So there are TWO hops — Railway's edge (which appends the caller and is on
  // a PUBLIC address) and an internal router on CGNAT space. With `1` we were
  // resolving `req.ip` to the edge, 152.233.15.120, for EVERY request. That
  // made the Telenor IP allow-list refuse all callers, collapsed the throttler
  // into a single global bucket (the 5/min public lead-form cap applied to the
  // whole internet at once, not per caller), and recorded the same useless
  // address on every audit row and login session.
  //
  // `2` is still forgery-proof: anything a caller puts in the header lands to
  // the LEFT of what Railway's edge observed, so Express walks past it. If all
  // entries end up trusted (a shorter chain) proxyaddr returns the leftmost,
  // which is the caller — so over-counting degrades gracefully, under-counting
  // does not. Override without a code change if Railway's topology shifts.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 2));

  // gzip every response big enough to be worth it. Measured on real prod rows:
  // one 30-row mobile inbox page is 82,741 bytes uncompressed and 17,367 gzipped
  // (4.8x). Reps are on Pakistani mobile data, so that transfer time is a large
  // share of what "the app is slow to load chats" actually feels like — far more
  // than any query tuning, because the database itself is ~3% busy.
  //
  // Mounted BEFORE the body parsers and routes so it wraps every response.
  // Media streaming (already-compressed jpeg/mp4/ogg bytes) is skipped via the
  // default `compression.filter`, which honours Content-Type and our own
  // `Cache-Control: no-transform`.
  app.use(
    compression({
      // 1 KB — below this the CPU + 20-byte gzip header cost more than they save.
      threshold: 1024,
    }),
  );

  // Meta WhatsApp webhook signature verification requires the RAW request
  // body. We mount a raw body parser for that path only; everything else
  // continues to use JSON parsing.
  app.use('/whatsapp/webhooks/meta', raw({ type: '*/*', limit: '4mb' }));
  app.use(json({ limit: '2mb' }));

  // Global validation pipe — strips unknown fields, transforms types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter — unified error response shape
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS — explicit allow-list with sensible defaults.
  // CORS_ALLOWED_ORIGINS env var (comma-separated) is the primary mechanism.
  // Defaults cover local dev (Next.js on :3000, Vite on :5173) plus the
  // production frontend on Railway, so a fresh deploy works without anyone
  // having to set the env var first. Any additional preview domains should
  // be added via CORS_ALLOWED_ORIGINS.
  const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'https://frontend-production-08d4.up.railway.app',
    'https://tashfeengroup.com',
    'https://www.tashfeengroup.com',
    // Public marketing site — posts website enquiries to /public/leads/website.
    // The Railway URL is the staging/preview host; the apex + www are where it
    // will live once the domain is pointed at it. All three listed so the form
    // keeps working through the cutover instead of breaking on switch-over day.
    'https://webnew-production.up.railway.app',
    'https://tashfeenimmigrationsolutions.com',
    'https://www.tashfeenimmigrationsolutions.com',
  ];
  const envOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins])];
  app.enableCors({
    // Function form so unmatched origins get a clean error rather than
    // express-cors throwing. Callback params typed explicitly because
    // strict mode otherwise infers `any` for them.
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Same-origin / curl / Postman requests have no Origin header. Allow.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.warn(`CORS rejected origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  });
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);

  const port = parseInt(process.env.PORT ?? process.env.APP_PORT ?? '3001', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`Tashfeen backend running on port ${port}`);
}

bootstrap();
