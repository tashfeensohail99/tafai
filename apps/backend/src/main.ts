// build-stamp: 2026-05-12T10:26:52.442Z
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, raw } from 'express';
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
  // The hop count matters. `1` means "one trusted proxy in front of us", so
  // Express walks back exactly one entry of X-Forwarded-For. That yields the
  // address Railway itself observed, which a caller cannot forge. Trusting the
  // whole chain (`true`) would take the LEFTMOST, caller-supplied entry and
  // hand any script a free throttle bypass — worse than no limiter, because it
  // would look like one is working. Revisit this number if another proxy (e.g.
  // Cloudflare) is ever put in front; it must equal the number of hops.
  app.set('trust proxy', 1);

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
