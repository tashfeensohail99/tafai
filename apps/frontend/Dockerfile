# =====================================================================
# Tafsheen Frontend — Multi-stage Dockerfile (Next.js standalone)
# Stage 1: deps     — installs production dependencies
# Stage 2: builder  — builds Next.js app with standalone output
# Stage 3: runner   — minimal image with only the standalone artefact
# =====================================================================

# ---- Stage 1: deps ----
FROM node:20-alpine AS deps

WORKDIR /app
RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci


# ---- Stage 2: builder ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Bake backend URL into the Next.js bundle at build time
# Set NEXT_PUBLIC_API_URL as a Railway build variable on this service
ARG NEXT_PUBLIC_API_URL=https://backend-production-5a89.up.railway.app
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
# Ensure public dir exists even if empty (required by Next.js standalone COPY)
RUN mkdir -p public
RUN npm run build


# ---- Stage 3: runner ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache tini

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy the standalone output — only what Next.js needs at runtime
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER appuser

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
