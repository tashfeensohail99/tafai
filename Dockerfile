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
# headless-Chrome PDF engine (puppeteer-core). The Alpine package ships a
# prebuilt browser so we never download one at npm-install time.
RUN apk add --no-cache \
      openssl tini \
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
# Run migrations then start — migrate deploy is idempotent after baselining
CMD ["sh", "-c", "(./node_modules/.bin/prisma migrate deploy && echo 'Migrations OK') || echo '[WARN] prisma migrate deploy failed — continuing startup'; node dist/main"]
