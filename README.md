# OGM Gönüllü Yönetim Sistemi — Backend API

T.C. Orman Genel Müdürlüğü Gönüllü Yönetim Sistemi'nin Node.js + Express + MySQL backend servisi. On-premise dağıtım için tasarlanmıştır; tüm bağımlılıklar Docker container'ları olarak çalışır.

> Frontend uygulamasının (React Native) tüm gereksinimleri `BACKEND_REQUIREMENTS.md`'ye göre uygulanmıştır: e-Devlet + Telefon OTP auth akışları, 6 adımlı onboarding (multipart upload), profil yönetimi, ana sayfa feed, yangın bildirimi, FCM cihaz kaydı, KVKK metinleri ve referans veri uçları.

## Tech Stack

- Node.js 20 LTS, Express.js 4
- MySQL 8.0, Redis 7
- Knex.js migration & query builder
- JWT (RS256-ready, default HS256) — access (15dk) + refresh (7d, rotation)
- Joi validasyonu (FE `zod` şemaları ile birebir uyumlu)
- Multer (multipart/form-data file upload)
- swagger-jsdoc + swagger-ui-express (`/docs`)
- Winston (yapısal JSON log, daily rotate)
- Docker + Docker Compose (dev & prod)
- Nginx reverse proxy

## Hızlı Başlangıç (Geliştirme)

### 1. Önkoşullar
- Docker Engine 24+ ve Docker Compose v2
- Node.js 20+ (yerel `npm install` veya migration komutları için)

### 2. Ortam değişkenleri
```bash
cp .env.example .env
# .env içindeki tüm `change_me_*` değerlerini güncelle
```

### 3. Geliştirme ortamını başlat (hot-reload)
```bash
docker compose -f docker-compose.dev.yml up --build
```
Backend `http://localhost:3001` adresinde, MySQL `localhost:3307`, Redis `localhost:6380` üzerinden erişilebilir olacaktır.

### 4. Migrate + seed
```bash
docker compose -f docker-compose.dev.yml exec backend npx knex migrate:latest
docker compose -f docker-compose.dev.yml exec backend npx knex seed:run
```

### 5. Smoke test
```bash
curl -s http://localhost:3001/health | jq
curl -s http://localhost:3001/v1/reference/kan-grubu | jq
curl -s http://localhost:3001/openapi.json | jq '.info.version, (.paths | keys | length)'
open http://localhost:3001/docs
```

## API Dokümantasyonu (Swagger UI)

- **Interaktif UI:** `GET /docs`
- **Spec (JSON):** `GET /openapi.json`
- **Statik export:** `npm run swagger:export` → `docs/openapi.json` üretilir.
- **Watch modu:** `npm run swagger:watch` → route/controller dosyaları değiştikçe otomatik yeniden üretir.

Tüm endpoint'ler `src/modules/<name>/<name>.routes.js` dosyalarında JSDoc `@openapi` blokları ile tanımlıdır. Yeni endpoint eklerken bu bloğu yazmak yeterli; spec çalışma zamanında otomatik build edilir.

### Mevcut endpoint'ler (özet)

| Modül | Path | Açıklama |
|---|---|---|
| Health | `GET /health`, `/health/live`, `/health/ready` | Liveness/readiness |
| Auth - Phone | `POST /v1/auth/phone/send-otp`, `verify-otp`, `resend-otp` | Telefon + OTP akışı |
| Auth - e-Devlet | `POST /v1/auth/edevlet/initiate`, `callback`; `GET /mock` | OAuth akışı (dev'de mock) |
| Auth - Token | `POST /v1/auth/refresh`, `/v1/auth/logout` | Token rotation + iptal |
| Onboarding | `POST /v1/onboarding/complete` | Multipart başvuru submit |
| Reference | `GET /v1/reference/{kategori}` | kan-grubu, ogrenim, meslek, hobiler, yakinlik, ulkeler |
| Users | `GET/PATCH /v1/users/me`, `POST /v1/users/me/avatar`, `POST /v1/users/me/consents` | Profil |
| Home | `GET /v1/home/feed` | Ana sayfa feed |
| Reports | `POST /v1/reports/fire` | Yangın bildirimi |
| Notifications | `POST/DELETE /v1/notifications/devices/...` | FCM cihaz kaydı |
| Legal | `GET /v1/legal/{document}` | KVKK / aydınlatma / açık rıza |

## Swagger güncelleme — `/update-swagger` slash komutu

`.claude/commands/update-swagger.md` dosyasında tanımlı bir Claude Code slash komutu vardır. Geliştirme sırasında istediğiniz an çalıştırın:

```
/update-swagger              # son git diff'e göre değişen modülleri analiz et
/update-swagger users        # sadece users modülü
/update-swagger --full       # tüm modüller
```

Komut şunları yapar:
1. Değişen `*.routes.js` ve `*.controller.js` dosyalarını tespit eder.
2. Eksik `@openapi` JSDoc bloklarını yazar / mevcut blokları günceller.
3. Yeni schema/tag gerekiyorsa `src/config/swagger.js`'i günceller.
4. `npm run swagger:export` ile `docs/openapi.json`'u yeniden üretir.
5. Diff'i raporlar.

Yardımcı bir komut: **`/api-add-endpoint <modül> <METHOD> <path>`** — yeni endpoint için controller/service/validator/route boilerplate'ini oluşturur ve sonunda swagger'ı günceller.

### Otomatik güncelleme (opsiyonel)

`.claude/hooks/swagger-autoupdate.sh` script'i hazır. Otomatik tetiklenmesi için Claude Code ayar dosyanıza şu hook'u ekleyebilirsiniz:

```jsonc
// ~/.claude/settings.json  (kullanıcı düzeyi) ya da .claude/settings.json (proje düzeyi)
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/swagger-autoupdate.sh" }
        ]
      }
    ]
  }
}
```

Kurulduktan sonra Claude her route/controller dosyasını düzenlediğinde `docs/openapi.json` sessizce güncellenir.

Alternatif: ayrı bir terminalde `npm run swagger:watch` çalıştırın; aynı işi fs.watch ile yapar.

## Üretim Modu

```bash
docker compose up -d --build
```

- Nginx 80/443 portlarında trafiği karşılar, backend'e proxy yapar.
- MySQL/Redis portları yalnızca `127.0.0.1` üzerinden açılır.
- Backend `node src/server.js` ile çalışır; container healthcheck `curl /health` üzerinden yapılır.

## Dış Servis Entegrasyonları

| Servis | Yapılandırma | Default | Notlar |
|---|---|---|---|
| **SMS / OTP** | `SMS_PROVIDER` | `mock` | `mock` (loglar OTP'yi) veya `netgsm` (gerçek SMS). `SMS_API_KEY/SECRET` zorunlu. |
| **e-Devlet OAuth** | `EDEVLET_MOCK_MODE` | `true` | Gerçek e-Devlet onayı 2-6 ay sürer. Mock mode dev/test için kullanılır. `EDEVLET_CLIENT_ID/SECRET` üretimde zorunlu. |
| **Dosya depolama** | `UPLOAD_DIR` | `/app/uploads` | Yerel disk. KVKK için 9 yıl saklama; production'da MinIO / S3 / Türk Telekom Bulut'a geçiş önerilir. |
| **FCM** | `FIREBASE_*` | — | Push notifications. Service account JSON dosyası container'a mount edilir. |
| **SMTP** | `SMTP_*` | — | Kurumsal mail sunucusu. |

## Veritabanı

Migration dosyaları `migrations/` altında, seed dosyaları `seeds/` altında.

Tablolar (Faz 1 MVP):
- `users` — gönüllü profili
- `refresh_tokens` — JWT refresh token'lar (rotation, blacklist Redis'te)
- `applications` — gönüllü başvuruları + dosya path'leri + snapshot
- `fire_reports` — yangın bildirimleri (lat/lon, foto path'leri)
- `devices` — FCM cihaz kayıtları
- `reference_data` — admin panelden yönetilebilen liste değerleri
- `consents` — KVKK / aydınlatma / açık rıza onayları
- `audit_log` — hassas işlemler için audit trail

```bash
# Migration uygula
docker compose exec backend npx knex migrate:latest

# Seed çalıştır (reference_data doldurulur)
docker compose exec backend npx knex seed:run

# Yeni migration üret
docker compose exec backend npx knex migrate:make create_trainings
```

## Dizin Yapısı

```
ogm/
├── docker/                       # Dockerfile, nginx, mysql init
├── docker-compose.yml            # Production stack
├── docker-compose.dev.yml        # Development stack (hot-reload)
├── docs/
│   └── openapi.json              # Swagger:export çıktısı
├── migrations/                   # Knex migration'ları (8 tablo)
├── seeds/                        # Seed data (reference_data)
├── scripts/
│   ├── export-openapi.js         # Swagger spec → docs/openapi.json
│   └── watch-swagger.js          # Watch modu
├── src/
│   ├── app.js                    # Express setup + route mount + Swagger UI
│   ├── server.js                 # Bootstrap & graceful shutdown
│   ├── config/                   # env, db, redis, logger, swagger
│   ├── middlewares/              # auth, validate, upload (multer), error-handler
│   ├── shared/                   # JWT, OTP, errors, async-handler, sms-provider, validate-tc-kimlik
│   └── modules/
│       ├── auth/                 # phone, edevlet, token (refresh/logout)
│       ├── onboarding/           # /onboarding/complete (multipart)
│       ├── users/                # /users/me, avatar, consents
│       ├── reference/            # /reference/{kategori}
│       ├── home/                 # /home/feed
│       ├── reports/              # /reports/fire
│       ├── notifications/        # /notifications/devices
│       ├── legal/                # /legal/{document}
│       └── health/               # /health
├── .claude/
│   ├── commands/
│   │   ├── update-swagger.md     # /update-swagger slash command
│   │   └── api-add-endpoint.md   # /api-add-endpoint slash command
│   └── hooks/
│       └── swagger-autoupdate.sh # PostToolUse otomatik tetikleyici (opsiyonel)
├── logs/                         # Winston günlük log dosyaları (volume)
├── uploads/                      # Yüklenen belgeler (volume)
├── backups/                      # MySQL yedekleri (volume)
├── knexfile.js
├── package.json
├── .env.example
├── BACKEND_REQUIREMENTS.md       # Frontend → backend gereksinimi
└── TECH_DESIGN.md                # Tam teknik tasarım
```

## Endpoint Standartı

Hata yanıtları:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Açıklayıcı mesaj",
    "details": { "errors": [{"field": "kimlik.tcKimlik", "message": "..."}] }
  }
}
```

Status kodu eşlemeleri (`src/shared/errors.js`):
- `VALIDATION_ERROR` → 400
- `UNAUTHORIZED` → 401
- `FORBIDDEN` → 403
- `NOT_FOUND` → 404
- `CONFLICT` → 409
- `BUSINESS_ERROR` → 422
- `RATE_LIMIT` → 429
- `INTERNAL_ERROR` → 500

## Loglama

- JSON yapısal log (Winston)
- Konsol + `/app/logs/app-YYYY-MM-DD.log` (90 gün retention, gzip)
- `LOG_LEVEL` env değişkeni ile seviye ayarlanır (`debug`, `info`, `warn`, `error`)

## Bilinen TODO'lar

- [ ] e-Devlet **kurumsal başvuru** (2-6 ay onay) — şimdiden başlatılmalı (`BACKEND_REQUIREMENTS.md §5.2`)
- [ ] NetGSM hesabı + sender ID doğrulaması (Türkiye marka kaydı)
- [ ] MinIO veya S3 dosya storage geçişi (KVKK için TR coğrafyası)
- [ ] FCM service account dosyasının prod ortamına aktarımı (Vault / Secrets Manager)
- [ ] PostgreSQL + PostGIS migrasyonu (yangın & görev konum sorguları için — opsiyonel)
- [ ] Sertifika pinning + gelişmiş rate limit (faz 4)
- [ ] Eğitimler / Blog / Aktif görevler API'leri (faz 2-3)
- [ ] `DELETE /users/me` (KVKK silme talebi) + 30 gün anonim/sil cron job

## Sonraki Adımlar

1. `.env`'i doldurun (özellikle `JWT_*`, `SMS_*`, `EDEVLET_*`, `DB_*PASSWORD`).
2. `docker compose -f docker-compose.dev.yml up --build` ile dev'i ayağa kaldırın.
3. `npx knex migrate:latest && npx knex seed:run` ile şemayı kurun.
4. `http://localhost:3001/docs` üzerinden Swagger UI'da endpoint'leri deneyin.
5. Yeni endpoint eklerken `/api-add-endpoint <modül> <METHOD> <path>` slash komutunu kullanın; bitince `/update-swagger` ile dokümantasyonu güncel tutun.
