import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.APP_PORT ?? '3001', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  storage: {
    endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
    secretKey: process.env.STORAGE_SECRET_KEY ?? '',
    bucket: process.env.STORAGE_BUCKET ?? 'tafsheen-documents',
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    signedUrlExpiresSeconds: parseInt(
      process.env.STORAGE_SIGNED_URL_EXPIRES_SECONDS ?? '300',
      10,
    ),
  },

  aiWorker: {
    url: process.env.AI_WORKER_URL ?? 'http://localhost:8000',
    apiKey: process.env.AI_WORKER_API_KEY ?? '',
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
    loginLimit: parseInt(process.env.LOGIN_THROTTLE_LIMIT ?? '5', 10),
    loginTtl: parseInt(process.env.LOGIN_THROTTLE_TTL_SECONDS ?? '300', 10),
  },

  // ---------------- Redis (BullMQ + realtime pub/sub) -----------------------
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  // ---------------- WhatsApp Cloud API integration -------------------------
  whatsapp: {
    metaAppId: process.env.META_APP_ID ?? '',
    metaAppSecret: process.env.META_APP_SECRET ?? '',
    metaGraphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v21.0',
    // Token YOU choose; given to Meta when subscribing webhooks. Meta echoes
    // it back on the GET handshake.
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? '',
    // AES-256-GCM key for encrypting stored access tokens. Must be 64 hex
    // chars (32 bytes). Generate with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    encryptionKey: process.env.WHATSAPP_ENCRYPTION_KEY ?? '',
    // Optional R2/S3 bucket for re-hosted inbound media. Falls back to the
    // shared `storage.*` config if unset.
    mediaBucket: process.env.WHATSAPP_MEDIA_BUCKET ?? '',
    mediaPublicBaseUrl: process.env.WHATSAPP_MEDIA_PUBLIC_BASE_URL ?? '',
  },
}));
