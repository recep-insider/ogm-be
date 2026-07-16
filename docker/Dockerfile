# Notlar:
# - npm 10.x'in "Exit handler never called!" bug'ı (npm/cli#7657) sunucuda
#   npm ci'yi tutarsız hâle getiriyor. Çözüm: node_modules'u yerel makinada
#   (linux/amd64 container içinde) hazırlayıp sunucuya rsync ile gönderiyoruz.
#   Bu Dockerfile sadece runtime image'ı kuruyor; npm ci yok.
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/logs /app/uploads

COPY --chown=node:node package.json package-lock.json knexfile.js ./
COPY --chown=node:node node_modules/ ./node_modules/
COPY --chown=node:node src/        ./src/
COPY --chown=node:node migrations/ ./migrations/
COPY --chown=node:node seeds/      ./seeds/
# Bakım script'leri (npm run backfill:locations gibi) container içinden
# çalıştırılıyor — image'a girmezse komut MODULE_NOT_FOUND ile ölür.
COPY --chown=node:node scripts/    ./scripts/

RUN chown -R node:node /app

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
