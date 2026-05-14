# =====================================================================
# Tafsheen Backend — Multi-stage Dockerfile
# Stage 1: builder  — installs deps, generates Prisma client, compiles
# Stage 2: runner   — lean production image, no devDeps, no source
# =====================================================================

# ---- Stage 1: builder ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma binary engine
RUN apk add --no-cache openssl

# Copy manifests first for layer-cache efficiency
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL deps (including devDependencies needed for build)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and compile
COPY . .
RUN npm run build


# ---- Stage 2: runner ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Runtime OS deps (ffmpeg for voice-note OGG/OPUS transcoding)
RUN apk add --no-cache openssl tini ffmpeg

# Copy only production node_modules (re-install without devDeps)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

# Use tini as PID 1 to handle signals correctly
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
