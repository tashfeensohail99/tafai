# =====================================================================
# Tashfeen Immigration Platform — Backend Build (repo-root context)
# =====================================================================

FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# Copy backend manifests and prisma from correct paths
COPY apps/backend/package*.json ./
COPY apps/backend/prisma ./prisma/

RUN npm install

COPY apps/backend/ .

RUN ./node_modules/.bin/prisma generate

RUN npm run build


FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# openssl/tini for runtime + prisma; chromium + font/render deps power the
# headless-Chrome PDF engine (puppeteer-core); ffmpeg transcodes WhatsApp voice
# notes (OGG/OPUS → WAV) for transcription. All are Alpine packages baked into
# the image layer, so the build never downloads a binary at npm-install time —
# this replaces the flaky `ffmpeg-static` npm package whose post-install pulled
# ffmpeg from a GitHub release and intermittently 504'd, failing the deploy.
RUN apk add --no-cache \
      openssl tini ffmpeg \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont

# puppeteer-core launches the system Chromium at this path. The render
# service also auto-detects, but pinning the env keeps startup deterministic.
ENV CHROMIUM_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_DOWNLOAD=true

# Copy entire node_modules from builder — avoids chasing transitive prisma deps
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY apps/backend/prisma ./prisma/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
# Run migrations then start. Retry up to 5x (absorbs transient DB-at-boot
# blips), then ABORT the boot if it still fails — so a failing migration
# keeps the previous healthy release serving instead of booting with a
# stale schema (which causes silent 500s). migrate deploy is idempotent.
CMD ["sh", "-c", "n=0; until ./node_modules/.bin/prisma migrate deploy; do n=$((n+1)); if [ \"$n\" -ge 5 ]; then echo '[migrate] FAILED after 5 attempts - aborting boot'; exit 1; fi; echo \"[migrate] attempt $n failed; retrying in 5s\"; sleep 5; done; echo '[migrate] OK'; node dist/main"]
