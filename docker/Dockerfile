# syntax=docker/dockerfile:1.7

# ─── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY migrations/ ./migrations/
COPY seeds/ ./seeds/
COPY knexfile.js ./

# ─── Runtime stage ────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini curl \
  && mkdir -p /app/logs /app/uploads \
  && chown -R node:node /app

COPY --from=builder --chown=node:node /app /app

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
