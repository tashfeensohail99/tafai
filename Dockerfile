# =====================================================================
# Tashfeen Immigration Platform — Frontend (Next.js standalone)
# Used by Railway "frontend" service via railway up
# Backend uses Dockerfile.backend (explicit dockerfilePath set on service)
# =====================================================================

# ---- Stage 1: deps ----
FROM node:20-alpine AS deps

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY apps/frontend/package*.json ./
RUN npm ci


# ---- Stage 2: builder ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY apps/frontend/ .

# Baked into Next.js bundle at build time
ARG NEXT_PUBLIC_API_URL=https://backend-production-5a89.up.railway.app
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# ---- Stage 3: runner ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache tini

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER appuser

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
