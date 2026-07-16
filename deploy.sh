#!/usr/bin/env bash
#
# OGM Gönüllü Yönetim Sistemi — Deploy Script
#
# Kullanım:
#   ./deploy.sh                          # default: root@94.73.180.124
#   ./deploy.sh root@host                # özel host
#   ./deploy.sh root@host:2222           # özel port
#   ./deploy.sh --fresh [root@host]      # SIFIRDAN kurulum (DB volume'ları SİLİNİR!)
#
# Mod seçimi (otomatik):
#   - Sunucuda $DEPLOY_DIR/.env varsa  → GÜNCELLEME modu: mevcut .env ve
#     DB/Redis volume'ları korunur; sadece kod rsync + rebuild + migrate yapılır.
#     Secret üretilmez, seed ÇALIŞTIRILMAZ (seed'ler referans tablolarını ezer).
#   - Yoksa → sıfırdan kurulum (secret üret, .env yaz, seed çalıştır).
#   - --fresh bayrağı mevcut kurulumu da sıfırdan kurmaya zorlar (onay ister).
#
# Önkoşullar (yerel makina):
#   - sshpass  (brew install hudochenkov/sshpass/sshpass)
#   - rsync    (macOS'ta default)
#   - openssl  (macOS'ta default)
#
# Script yaptıkları:
#   1. Secret'ları yerel olarak üretir (openssl rand)
#   2. .env'yi local'de hazırlar
#   3. rsync ile projeyi sunucuya gönderir
#   4. Sunucuda Docker yoksa kurar
#   5. docker compose up -d --build
#   6. migrate + seed
#   7. Smoke test
#   8. PRODUCTION-SECRETS.md'yi yerel makinada bırakır

set -euo pipefail

# ─── Yapılandırma ──────────────────────────────────────────────
FRESH=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    *) TARGET="$arg" ;;
  esac
done
TARGET="${TARGET:-root@94.73.180.124}"
DEPLOY_DIR=/opt/ogm-gonullu
LOCAL_REPO="$(cd "$(dirname "$0")" && pwd)"

# TARGET'tan host:port ayır
TARGET_HOST="${TARGET#*@}"
SSH_HOST="${TARGET_HOST%:*}"
SSH_PORT="22"
if [[ "$TARGET_HOST" == *:* ]]; then
  SSH_PORT="${TARGET_HOST##*:}"
  TARGET="${TARGET%:*}"
fi

# ─── Renkli output ──────────────────────────────────────────────
log()  { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ─── Pre-flight ──────────────────────────────────────────────
log "Pre-flight kontrol"
command -v sshpass >/dev/null || die "sshpass yok. Kur: brew install hudochenkov/sshpass/sshpass"
command -v openssl >/dev/null || die "openssl yok."
command -v rsync   >/dev/null || die "rsync yok."
[ -f "$LOCAL_REPO/docker-compose.yml" ] || die "docker-compose.yml bulunamadı. Script'i repo kökünde çalıştırın."
ok "Yerel araçlar tamam"

# ─── Parola ──────────────────────────────────────────────
read -rsp "SSH parolası ($TARGET, port $SSH_PORT): " SSHPASS
echo
[ -n "$SSHPASS" ] || die "Parola boş olamaz."
export SSHPASS

# SSH wrapper'ları
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p "$SSH_PORT")

run_ssh()   { sshpass -e ssh  "${SSH_OPTS[@]}" "$TARGET" "$@"; }
# Dosya transferi için scp KULLANILMIYOR: sshpass scp'nin fork ettiği alt-ssh'in
# parola promptunu (özellikle macOS'ta) yakalayamıyor. rsync ise sshpass'i doğrudan
# ssh'e sardığından auth çalışıyor — tek dosya transferleri de rsync üzerinden gider.
run_rsync() { rsync -e "sshpass -e ssh ${SSH_OPTS[*]}" "$@"; }

# ─── Bağlantı testi ──────────────────────────────────────────────
log "SSH bağlantısı test ediliyor"
run_ssh 'echo connected' >/dev/null || die "SSH başarısız."
ok "Bağlantı OK"

# ─── Sunucu inventory ──────────────────────────────────────────────
log "Sunucu inventory"
OS_ID=$(run_ssh '. /etc/os-release && echo $ID')
OS_VER=$(run_ssh '. /etc/os-release && echo $VERSION_ID')
ARCH=$(run_ssh 'uname -m')
DISK_FREE=$(run_ssh "df -h / | awk 'NR==2{print \$4}'")
RAM_INFO=$(run_ssh "free -h | awk 'NR==2{printf \"%s toplam / %s boş\", \$2, \$7}'")
echo "  OS    : $OS_ID $OS_VER ($ARCH)"
echo "  Disk  : $DISK_FREE boş"
echo "  RAM   : $RAM_INFO"
ok "Inventory tamam"

# ─── Mod tespiti (update / fresh) ──────────────────────────────────────────────
log "Deploy modu tespit ediliyor"
if [ "$FRESH" = "1" ]; then
  MODE=fresh
  warn "--fresh: sıfırdan kurulum zorlandı."
elif run_ssh "[ -f $DEPLOY_DIR/.env ]"; then
  MODE=update
  ok "Mevcut kurulum bulundu → GÜNCELLEME modu (.env ve DB/Redis volume'ları korunacak)"
else
  MODE=fresh
  ok "Mevcut kurulum yok → sıfırdan kurulum"
fi

# ─── Çakışan deploy / port kontrolü (sadece fresh) ──────────────────────────────
if [ "$MODE" = "fresh" ]; then
  log "Mevcut deploy ve port çakışması kontrolü"
  if run_ssh "[ -d $DEPLOY_DIR ]"; then
    warn "$DEPLOY_DIR zaten var."
    warn "DİKKAT: Sıfırdan kurulum MySQL/Redis volume'larını ve TÜM VERİYİ siler."
    warn "Veriyi korumak için --fresh olmadan çalıştırın (güncelleme modu)."
    read -rp "Üzerine yazılsın mı? (data volume'ları da silinecek; yazmak için 'evet'): " CONFIRM
    [ "$CONFIRM" = "evet" ] || die "İptal edildi."
    # Eski stack'i, volume'ları ve local image'ı temizle (cache'li bozuk image olmasın)
    if run_ssh "[ -f $DEPLOY_DIR/docker-compose.yml ] && command -v docker >/dev/null"; then
      warn "Eski stack durduruluyor (volume + local image dahil)..."
      run_ssh "cd $DEPLOY_DIR && docker compose down -v --remove-orphans --rmi local 2>/dev/null || true"
    fi
  fi
  PORT80=$(run_ssh "ss -ltn '( sport = :80 )' | tail -n +2 || true")
  if [ -n "$PORT80" ]; then
    warn "Port 80 zaten kullanılıyor:"
    echo "$PORT80"
    read -rp "Yine de devam edilsin mi? (yazmak için 'evet'): " CONFIRM
    [ "$CONFIRM" = "evet" ] || die "İptal edildi."
  fi
  ok "Port/dizin OK"
fi

# ─── Docker kur / kontrol ──────────────────────────────────────────────
log "Docker kontrol"
if run_ssh 'command -v docker && docker compose version' >/dev/null 2>&1; then
  ok "Docker + Compose v2 mevcut"
else
  warn "Docker yok, resmi Docker repo'sundan kuruluyor..."
  case "$OS_ID" in
    ubuntu|debian)
      run_ssh "set -e
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq ca-certificates curl gnupg
        install -m 0755 -d /etc/apt/keyrings
        if [ ! -f /etc/apt/keyrings/docker.asc ]; then
          curl -fsSL https://download.docker.com/linux/$OS_ID/gpg -o /etc/apt/keyrings/docker.asc
          chmod a+r /etc/apt/keyrings/docker.asc
        fi
        CODENAME=\$(. /etc/os-release && echo \$VERSION_CODENAME)
        ARCH=\$(dpkg --print-architecture)
        echo \"deb [arch=\$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$OS_ID \$CODENAME stable\" > /etc/apt/sources.list.d/docker.list
        apt-get update -qq
        apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin
      "
      ;;
    centos|rhel|almalinux|rocky)
      run_ssh "set -e
        dnf install -y -q dnf-plugins-core
        (dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null \
          || dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/centos/docker-ce.repo)
        dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin
      "
      ;;
    fedora)
      run_ssh "set -e
        dnf install -y -q dnf-plugins-core
        (dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo 2>/dev/null \
          || dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo)
        dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin
      "
      ;;
    *)
      die "Bilinmeyen OS: $OS_ID. Docker'ı manuel kurun."
      ;;
  esac
  run_ssh 'systemctl enable --now docker'
  run_ssh 'docker compose version' >/dev/null || die "Compose v2 kurulamadı."
  ok "Docker kuruldu"
fi

# ─── Secret üret (sadece fresh — update'te mevcut .env korunur) ─────────────
if [ "$MODE" = "fresh" ]; then
  log "Secret üretiliyor (yerel openssl)"
  gen_pw()    { openssl rand -base64 32 | tr -d '=+/' | head -c 32; }
  gen_hex()   { openssl rand -hex 64; }

  DB_ROOT_PW=$(gen_pw)
  DB_PW=$(gen_pw)
  REDIS_PW=$(gen_pw)
  JWT_ACCESS=$(gen_hex)
  JWT_REFRESH=$(gen_hex)
  ADMIN_API_KEY=$(gen_hex)
  OFFICER_API_KEY=$(gen_hex)
  SCAN_HMAC_SECRET=$(gen_hex)
  ok "Secret'lar hazır (ekrana basılmayacak)"
else
  log "Güncelleme modu: secret üretimi atlandı (sunucudaki .env korunuyor)"
fi

# ─── Yerel npm install (linux/amd64 platformu için) ──────────────────────────────
# Sunucudaki npm 10.x bug'ı yüzünden node_modules'u yerel makinada hazırlıyoruz.
# Docker ile linux/amd64 platform'da npm ci çalıştırılır (qemu emulation).
log "node_modules yerel olarak hazırlanıyor (linux/amd64 container)"
command -v docker >/dev/null || die "Docker yerelde bulunamadı."
docker info >/dev/null 2>&1 || die "Docker Desktop çalışmıyor."
docker run --rm \
  -v "$LOCAL_REPO:/app" \
  -w /app \
  --platform linux/amd64 \
  node:20-bookworm-slim \
  bash -c "rm -rf node_modules && npm ci --omit=dev --no-audit --no-fund" \
  || die "Yerel npm ci başarısız."
[ -f "$LOCAL_REPO/node_modules/express/package.json" ] \
  || die "node_modules eksik üretildi (express yok)."
ok "node_modules hazır ($(du -sh "$LOCAL_REPO/node_modules" | awk '{print $1}'))"

# ─── Geçici dizin ──────────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"; unset SSHPASS' EXIT
chmod 700 "$TMPDIR"

# ─── .env üret (sadece fresh) ──────────────────────────────────────────────
if [ "$MODE" = "fresh" ]; then
log ".env üretiliyor (production)"
cat > "$TMPDIR/.env" <<EOF
# ── Server ──────────────────────────────────────
NODE_ENV=production
PORT=3000

# ── Database (MySQL container) ─────
DB_HOST=mysql
DB_PORT=3306
DB_NAME=ogm_gonullu
DB_USER=ogm_app
DB_PASSWORD=$DB_PW
DB_ROOT_PASSWORD=$DB_ROOT_PW

# ── Redis (container) ────────────────
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PW

# ── JWT ─────────────────────────────────────────
JWT_ACCESS_SECRET=$JWT_ACCESS
JWT_REFRESH_SECRET=$JWT_REFRESH
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_REGISTRATION_EXPIRES_IN=30m

# ── Email (SMTP devre dışı — bo gerçek provider eklenince güncelle) ──────────────────────
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_NAME=OGM Gönüllü Sistemi
SMTP_FROM_EMAIL=noreply@localhost

# ── SMS / OTP (mock — OTP'ler log'a yazılır) ───────────────────────────────
SMS_PROVIDER=mock
SMS_API_URL=
SMS_API_KEY=
SMS_API_SECRET=
SMS_SENDER_ID=OGM GONULLU
SMS_OTP_LENGTH=6
SMS_OTP_EXPIRES_IN=300
SMS_OTP_MAX_ATTEMPTS=5
SMS_OTP_LOCKOUT_DURATION=1800
SMS_DAILY_LIMIT_PER_USER=10
SMS_RESEND_COOLDOWN=30
# Dummy OTP — bu numaralar SMS göndermez, OTP_DUMMY_CODE ile doğrulanır (app store review / QA).
OTP_DUMMY_PHONES=+905555555555
OTP_DUMMY_CODE=123456

# ── e-Devlet (mock) ────────────────────────────────
EDEVLET_ENABLED=true
EDEVLET_MOCK_MODE=true
EDEVLET_AUTHORIZE_URL=https://sanal-test.turkiye.gov.tr/oauth/authorize
EDEVLET_TOKEN_URL=https://sanal-test.turkiye.gov.tr/oauth/token
EDEVLET_USERINFO_URL=https://sanal-test.turkiye.gov.tr/oauth/userinfo
EDEVLET_CLIENT_ID=
EDEVLET_CLIENT_SECRET=
EDEVLET_CALLBACK_URL=http://$SSH_HOST/v1/auth/edevlet/callback
EDEVLET_SESSION_TTL=600

# ── Upload / Storage ────────────────────────────
UPLOAD_DIR=/app/uploads
# assetUrl() çıktısı bu base + /<path>. express.static mount'u /uploads olduğu için
# base /uploads ile bitmeli; aksi halde /seed/... gibi URL'ler 404 olur.
UPLOAD_PUBLIC_BASE_URL=http://$SSH_HOST/uploads
UPLOAD_MAX_DOC_BYTES=10485760
UPLOAD_MAX_AVATAR_BYTES=5242880
UPLOAD_MAX_REPORT_PHOTOS=5

# ── App URLs ────────────────────────────────────
APP_URL=http://$SSH_HOST
API_URL=http://$SSH_HOST

# ── Swagger ───────────────────────────
SWAGGER_ENABLED=true

# ── Push Notification (mock — gerçek FCM için firebase) ────
PUSH_PROVIDER=mock

# ── Firebase (devre dışı) ────
FIREBASE_PROJECT_ID=
FIREBASE_CREDENTIALS_PATH=

# ── Admin / Officer (panel & saha amiri uçları; mobil çağırmaz) ──
# Scan ve admin uçları x-api-key ile korunur. Boş bırakılırsa bu uçlar 403 döner.
ADMIN_API_KEY=$ADMIN_API_KEY
OFFICER_API_KEY=$OFFICER_API_KEY
SCAN_HMAC_SECRET=$SCAN_HMAC_SECRET

# ── Reverse geocode (boşsa public OSM Nominatim; sn'de 1 istek throttle'ı kodda) ──
# Kalıcı çözüm: self-hosted Nominatim container adresi yaz.
NOMINATIM_URL=

# ── Logging ─────────────────────────────────────
LOG_LEVEL=info
LOG_DIR=/app/logs
EOF
chmod 600 "$TMPDIR/.env"
ok ".env hazır"
fi

# ─── Rsync exclude listesi ──────────────────────────────────────────────
# Not: node_modules dahil ediliyor (yerel'de linux/amd64 için kuruldu).
cat > "$TMPDIR/rsync-exclude" <<EOF
.git/
.idea/
.vscode/
.claude/
.DS_Store
logs/
uploads/
backups/
coverage/
*.log
.env
.env.*
.tunnel/
deploy.sh
setup-domain.sh
PRODUCTION-SECRETS.md
certbot/
EOF

# ─── Deploy dizini hazırla ──────────────────────────────────────────────
log "Sunucuda $DEPLOY_DIR hazırlanıyor"
run_ssh "mkdir -p $DEPLOY_DIR && chmod 755 $DEPLOY_DIR"

# ─── Rsync transfer ──────────────────────────────────────────────
log "Dosyalar transfer ediliyor (rsync)"
run_rsync -az --delete \
  --exclude-from="$TMPDIR/rsync-exclude" \
  "$LOCAL_REPO/" "$TARGET:$DEPLOY_DIR/"
ok "Transfer tamam"

# ─── .env gönder (sadece fresh — update'te sunucudaki .env'e dokunulmaz) ─────
if [ "$MODE" = "fresh" ]; then
  log ".env transfer"
  run_rsync -az "$TMPDIR/.env" "$TARGET:$DEPLOY_DIR/.env"
  run_ssh "chmod 600 $DEPLOY_DIR/.env"
  ok ".env yerinde"
else
  log "Güncelleme modu: .env transferi atlandı (sunucudaki mevcut .env kullanılacak)"
fi

# ─── Volume dizinleri (node user uid 1000 için) ──────────────────────────────────────
# logs ve uploads bind-mount; container içindeki node user (uid 1000) yazabilmeli.
log "Volume dizinleri hazırlanıyor"
run_ssh "cd $DEPLOY_DIR && mkdir -p logs uploads backups/mysql && chown -R 1000:1000 logs uploads"
ok "Volume dizinleri hazır"

# ─── Seed statik varlıkları (uploads/seed + örnek eğitim videosu) ─────────────
# Ana rsync uploads/'ı tamamen hariç tutuyor (--delete kullanıcı içeriğini ezmesin diye).
# Seed görselleri ve örnek video'yu --delete OLMADAN ayrıca gönder: kullanıcı yüklemelerine
# (avatars/missions/reports) dokunmadan blog/yazar/eğitim placeholder'larını yerine koyar.
# NOT: Bunlar PLACEHOLDER; gerçek varlıklar sunucudaki uploads/seed ve uploads/trainings
# altına ayrıca konulduğunda bu adım onları EZMEZ çünkü --delete yok ve aynı isimde dosya
# varsa üzerine yazar — gerçek içerik koyulduysa deploy'da bu adımı atlayın/parametreleyin.
if [ -d "$LOCAL_REPO/uploads/seed" ] || [ -d "$LOCAL_REPO/uploads/trainings" ]; then
  log "Seed statik varlıkları transfer ediliyor (uploads/seed, uploads/trainings)"
  [ -d "$LOCAL_REPO/uploads/seed" ] && \
    run_rsync -az "$LOCAL_REPO/uploads/seed/" "$TARGET:$DEPLOY_DIR/uploads/seed/"
  [ -d "$LOCAL_REPO/uploads/trainings" ] && \
    run_rsync -az "$LOCAL_REPO/uploads/trainings/" "$TARGET:$DEPLOY_DIR/uploads/trainings/"
  run_ssh "cd $DEPLOY_DIR && chown -R 1000:1000 uploads/seed uploads/trainings 2>/dev/null || true"
  ok "Seed statik varlıkları yerinde"
fi

# ─── docker compose up (build + start) ──────────────────────────────────────────────
# Dockerfile artık npm ci yapmıyor; sadece COPY ediyor. Build hızlı (~30sn).
log "docker compose up -d --build"
run_ssh "cd $DEPLOY_DIR && docker compose up -d --build"
ok "Container'lar başlatıldı"

# ─── Backend healthy bekle ──────────────────────────────────────────────
log "Backend healthy bekleniyor (max 5dk)"
STATUS=""
for i in $(seq 1 100); do
  STATUS=$(run_ssh "docker inspect -f '{{.State.Health.Status}}' ogm-backend 2>/dev/null" 2>/dev/null || echo "starting")
  printf "  [%d/100] %s\r" "$i" "$STATUS"
  [ "$STATUS" = "healthy" ] && { echo; break; }
  sleep 3
done
if [ "$STATUS" != "healthy" ]; then
  echo
  err "Backend healthy olmadı. Son loglar:"
  run_ssh "cd $DEPLOY_DIR && docker compose logs --tail 80 backend" || true
  die "Deploy başarısız."
fi
ok "Backend healthy"

# ─── Migration + seed ──────────────────────────────────────────────
log "Knex migration"
run_ssh "cd $DEPLOY_DIR && docker compose exec -T backend npx knex migrate:latest"
ok "Migration tamam"

# Seed sadece fresh'te: 01_reference_data.js tabloyu del() ile sıfırlayıp yeniden
# yazıyor, 06_dev_demo.js demo kullanıcıyı siliyor — mevcut veriye dokunmamak için
# güncelleme modunda seed ÇALIŞTIRILMAZ. Gerekirse sunucuda elle:
#   docker compose exec -T backend npx knex seed:run
if [ "$MODE" = "fresh" ]; then
  log "Knex seed (referans data)"
  run_ssh "cd $DEPLOY_DIR && docker compose exec -T backend npx knex seed:run"
  ok "Seed tamam"
else
  log "Güncelleme modu: seed atlandı (mevcut data korunuyor)"
fi

# ─── Smoke test ──────────────────────────────────────────────
log "Smoke test"
run_ssh "curl -fsS http://localhost/health"   && echo
run_ssh "curl -fsS http://localhost/health/ready" && echo
run_ssh "curl -fsS http://localhost/v1/reference/kan-grubu | head -c 200" && echo
ok "Smoke test geçti"

# ─── PRODUCTION-SECRETS.md (sadece fresh — update'te secret üretilmedi) ──────
if [ "$MODE" = "fresh" ]; then
SECRETS_FILE="$LOCAL_REPO/PRODUCTION-SECRETS.md"
cat > "$SECRETS_FILE" <<EOF
# OGM Gönüllü — Production Secrets

> **ÖNEMLİ**: Bu dosya .gitignore'da. Asla commitlemeyin, paylaşmayın.
> Üretim tarihi: $(date '+%Y-%m-%d %H:%M:%S')

## Sunucu

- **Host**: $TARGET (port $SSH_PORT)
- **Deploy dizini**: $DEPLOY_DIR
- **API URL**: http://$SSH_HOST
- **Swagger UI**: http://$SSH_HOST/docs
- **Health**: http://$SSH_HOST/health

## Üretilmiş secret'lar

\`\`\`
DB_ROOT_PASSWORD=$DB_ROOT_PW
DB_PASSWORD=$DB_PW
REDIS_PASSWORD=$REDIS_PW
JWT_ACCESS_SECRET=$JWT_ACCESS
JWT_REFRESH_SECRET=$JWT_REFRESH
ADMIN_API_KEY=$ADMIN_API_KEY
OFFICER_API_KEY=$OFFICER_API_KEY
SCAN_HMAC_SECRET=$SCAN_HMAC_SECRET
\`\`\`

> **Admin paneli** \`x-api-key: <ADMIN_API_KEY>\`, **saha amiri** \`x-api-key: <OFFICER_API_KEY>\` header'ı ile çağırır.

## Devre dışı entegrasyonlar (mock/empty mode)

| Entegrasyon | Durum | Aktifleştirmek için |
|---|---|---|
| SMS | mock (OTP log'a yazılır) | \`SMS_PROVIDER=netgsm\` + \`SMS_API_KEY\`, \`SMS_API_SECRET\` |
| e-Devlet | mock | \`EDEVLET_MOCK_MODE=false\` + \`EDEVLET_CLIENT_ID/SECRET\` |
| SMTP | boş | \`SMTP_HOST/USER/PASSWORD\` doldur |
| FCM | boş | \`FIREBASE_PROJECT_ID\` + service account JSON |
| SSL | yok (HTTP) | Domain + Let's Encrypt (certbot) |

## Faydalı komutlar

\`\`\`bash
# Sunucuda servis durumu
ssh $TARGET 'cd $DEPLOY_DIR && docker compose ps'

# Logları takip et
ssh $TARGET 'cd $DEPLOY_DIR && docker compose logs -f backend'

# .env güncelle ve restart
ssh $TARGET 'cd $DEPLOY_DIR && nano .env && docker compose restart backend'

# Yeniden deploy (bu script tekrar çalıştırılır, mevcut dizini soracak)
./deploy.sh
\`\`\`

## Önemli notlar

- DB ve Redis sadece 127.0.0.1'e bağlı, dışarıdan erişilemez.
- MySQL volume'ı sunucuda \`mysql-data\` Docker volume'unda. Backup almak için: \`docker compose exec mysql mysqldump -u root -p\\\$DB_ROOT_PASSWORD ogm_gonullu > backup.sql\`
- SSL/domain eklenince \`docker/nginx/nginx.conf\`'a 443 server bloğu eklenmeli; \`EDEVLET_CALLBACK_URL\`, \`APP_URL\`, \`API_URL\` env'leri https'ye çevrilmeli.
EOF
chmod 600 "$SECRETS_FILE"
fi

# ─── Özet ──────────────────────────────────────────────
echo
ok "═══════════════════════════════════════════════════════"
if [ "$MODE" = "fresh" ]; then
  ok "Deploy başarılı (sıfırdan kurulum)"
else
  ok "Deploy başarılı (güncelleme — data ve .env korundu)"
fi
ok "═══════════════════════════════════════════════════════"
echo
echo "  API       : http://$SSH_HOST/health"
echo "  Swagger   : http://$SSH_HOST/docs"
echo "  Reference : http://$SSH_HOST/v1/reference/kan-grubu"
echo
echo "  Sunucu    : $TARGET"
echo "  Dizin     : $DEPLOY_DIR"
if [ "$MODE" = "fresh" ]; then
  echo "  Secret'lar: $SECRETS_FILE  (chmod 600, .gitignore'da)"
fi
echo
echo "  Logları takip et:"
echo "    sshpass -e ssh ${SSH_OPTS[*]} $TARGET 'cd $DEPLOY_DIR && docker compose logs -f backend'"
echo
