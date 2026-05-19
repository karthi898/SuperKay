# ---- Build stage ----
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate
RUN npm run build

# Strip dev deps
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:20-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
# Cloud Scheduler hits /process; no need for in-process polling.
ENV POLLING_AUTO_START=false

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

CMD sh -c "npx prisma migrate resolve --rolled-back 20260513092521_init 2>/dev/null; npx prisma migrate deploy && node dist/index.js"
