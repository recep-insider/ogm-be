#!/usr/bin/env bash
#
# OGM Gönüllü Yönetim Sistemi — Deploy Script
#
# Kullanım:
#   ./deploy.sh                          # default: root@185.22.187.88
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

# ─── Renkli output ──────────────────────────────────────────────
log()  { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ─── Yapılandırma ──────────────────────────────────────────────
FRESH=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    # Mod seçimi veri silen bir karar: yazım hatasını ("--frsh") sessizce SSH
    # hedefi sanmak yerine dur.
    --*) die "Bilinmeyen bayrak: $arg" ;;
    *)
      [ -z "$TARGET" ] || die "Birden fazla hedef verildi: '$TARGET' ve '$arg'"
      TARGET="$arg"
      ;;
  esac
done
TARGET="${TARGET:-root@185.22.187.88}"
DEPLOY_DIR=/opt/ogm-gonullu
# Reverse geocode varsayılanı — hem fresh .env şablonu hem update modundaki
# ensure_env_key buradan okur (self-hosted'a geçilince tek yer değişsin).
NOMINATIM_DEFAULT_URL=https://nominatim.openstreetmap.org
LOCAL_REPO="$(cd "$(dirname "$0")" && pwd)"

# TARGET'tan host:port ayır
TARGET_HOST="${TARGET#*@}"
SSH_HOST="${TARGET_HOST%:*}"
SSH_PORT="22"
if [[ "$TARGET_HOST" == *:* ]]; then
  SSH_PORT="${TARGET_HOST##*:}"
  TARGET="${TARGET%:*}"
fi

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

# ── SMS / OTP (mock — SMS gönderilmez, kod loglanmaz; giriş OTP_DUMMY_* ile) ──────────
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

# ── Saha amiri (QR scan; mobil çağırmaz) ──
# Panel kullanıcıları /v1/admin/auth/login ile girer; saha amiri cihazı x-api-key ile çağırır.
OFFICER_API_KEY=$OFFICER_API_KEY
SCAN_HMAC_SECRET=$SCAN_HMAC_SECRET

# ── Reverse geocode (boşsa fire-report locationName 'Bilinmeyen Konum' kalır) ──
# Public OSM: sn'de 1 istek (throttle kodda). Koordinat kişisel veri — kalıcı
# çözüm self-hosted Nominatim container adresi.
NOMINATIM_URL=$NOMINATIM_DEFAULT_URL

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
frontend/
secrets/
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

# grep rc: 0 = eşleşti, 1 = eşleşmedi, diğer = ssh/dosya hatası. Hata "yok"
# sayılırsa anahtar mükerrer yazılır ve operatörün değeri sessizce değişir.
_env_has() {
  local pattern="$1" rc=0
  run_ssh "grep -q '$pattern' $DEPLOY_DIR/.env" || rc=$?
  case "$rc" in
    0|1) return "$rc" ;;
    *) die ".env okunamadı (ssh/grep çıkış kodu $rc) — dosyaya dokunulmadı" ;;
  esac
}

# Tek .env yazıcısı: anahtar varsa değerini değiştirir, yoksa ekler, sonra doğrular.
# Karar (ez / koru) çağıranındır. sed replacement'ında '&' tüm eşleşme demek;
# kaçışlanmazsa değer sessizce bozulur. (Hedef Ubuntu/Debian: GNU sed.)
_env_write() {
  local key="$1" val="$2"
  local val_esc=${val//&/\\&}
  if _env_has "^${key}="; then
    run_ssh "sed -i 's|^${key}=.*|${key}=${val_esc}|' $DEPLOY_DIR/.env"
  else
    run_ssh "printf '\\n%s\\n' '${key}=${val}' >> $DEPLOY_DIR/.env"
  fi
  _env_has "^${key}=${val}\$" || die "$key yazılamadı — .env'i sunucuda elle kontrol edin"
}

# Tek anahtarın değerini okur; diğer satırlar sunucudan çıkmaz.
_env_get() { run_ssh "grep -m1 '^$1=' $DEPLOY_DIR/.env | cut -d= -f2-"; }
# URL değerini tırnak ve sondaki / olmadan döndürür.
_env_get_url() { local v; v=$(_env_get "$1") || return; v=${v//\"/}; v=${v//\'/}; printf '%s' "${v%/}"; }

# ─── .env gönder (sadece fresh — update'te sunucudaki .env'e dokunulmaz) ─────
if [ "$MODE" = "fresh" ]; then
  log ".env transfer"
  run_rsync -az "$TMPDIR/.env" "$TARGET:$DEPLOY_DIR/.env"
  run_ssh "chmod 600 $DEPLOY_DIR/.env"
  ok ".env yerinde"
else
  log "Güncelleme modu: .env transferi atlandı (sunucudaki mevcut .env kullanılacak)"

  # Sunucudaki .env korunduğu için yeni sürümle gelen anahtarlar oraya kendi
  # başına ulaşmaz — eksikse eklenir, MEVCUT DEĞER ASLA EZİLMEZ.
  # Buraya yalnızca secret OLMAYAN, varsayılanı güvenle yazılabilen anahtarlar girer.
  # (_env_has yukarıda tanımlı — push ayarları da aynı güvenli okumayı kullanır.)
  ensure_env_key() {
    local key="$1" val="$2"
    # Eski şablon anahtarı BOŞ yazıyordu ('NOMINATIM_URL='). Sadece '^key='
    # aranırsa o boş satır "tanımlı" sanılır, atlanır ve düzeltme sunucuya hiç
    # ulaşmaz. Bu yüzden ölçüt "dolu mu" (=' den sonra en az bir karakter).
    if _env_has "^${key}=..*"; then
      ok "  $key: zaten dolu, dokunulmadı"
      return
    fi

    # Boş satır doldurulur, eksik anahtar eklenir (mükerrer satır yazılmaz).
    if _env_has "^${key}="; then
      warn "  $key: boştu, dolduruluyor → $val"
    else
      warn "  $key: eksikti, ekleniyor → $val"
    fi
    _env_write "$key" "$val"
  }
  log "Yeni env anahtarları kontrol ediliyor"
  # Boş kalırsa yangın ihbarı konumu 'Bilinmeyen Konum' olarak yazılır.
  ensure_env_key NOMINATIM_URL "$NOMINATIM_DEFAULT_URL"
  # Nominatim'e giden User-Agent'taki iletişim adresi buradan geliyor; eksikse
  # env.js 'http://localhost'a düşer ve OSM'in istediği adres işe yaramaz olur.
  ensure_env_key APP_URL "http://$SSH_HOST"
  # Eski setup-domain.sh bu anahtarı https'e çevirmiyordu; https sayfada http
  # yükleme URL'leri mixed content olarak engellenir.
  if _env_has "^API_URL=https://" && _env_has "^UPLOAD_PUBLIC_BASE_URL=http://"; then
    UPLOAD_URL="$(_env_get_url API_URL)/uploads"
    warn "  UPLOAD_PUBLIC_BASE_URL: http → $UPLOAD_URL"
    _env_write UPLOAD_PUBLIC_BASE_URL "$UPLOAD_URL"
  fi
fi

# ─── Push (FCM) ──────────────────────────────────────────────────────────────
# Gerçek push için Firebase service account gerekir. Anahtar repoda ve imajda
# yoktur; operatörün makinesindeki secrets/firebase-sa.json varsa sunucuya
# gönderilir. Sunucudaki mevcut değerler korunur: yalnızca mock/boş sağlayıcı
# firebase'e çevrilir, boş anahtarlar doldurulur. Sunucu zaten başka bir Firebase
# projesine bağlıysa (ör. staging anahtarıyla prod'a deploy) durulur.

FIREBASE_SA_LOCAL="$LOCAL_REPO/secrets/firebase-sa.json"
FIREBASE_SA_PATH=/app/secrets/firebase-sa.json
if [ -f "$FIREBASE_SA_LOCAL" ]; then
  FIREBASE_PROJECT=$(grep -o '"project_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$FIREBASE_SA_LOCAL" | sed 's/.*"\([^"]*\)"$/\1/')
  [ -n "$FIREBASE_PROJECT" ] || die "secrets/firebase-sa.json içinde project_id yok"

  if _env_has "^FIREBASE_PROJECT_ID=..*" && ! _env_has "^FIREBASE_PROJECT_ID=${FIREBASE_PROJECT}\$"; then
    die "Sunucu başka bir Firebase projesine bağlı; yerel anahtar '$FIREBASE_PROJECT' için. Yanlış ortama deploy olabilir — .env'i sunucuda kontrol edin."
  fi

  log "Firebase service account gönderiliyor (proje: $FIREBASE_PROJECT)"
  run_ssh "mkdir -p $DEPLOY_DIR/secrets"
  run_rsync -az "$FIREBASE_SA_LOCAL" "$TARGET:$DEPLOY_DIR/secrets/firebase-sa.json"
  # Container içindeki node kullanıcısı (uid 1000) okuyabilmeli, başkası değil.
  run_ssh "chown -R 1000:1000 $DEPLOY_DIR/secrets && chmod 700 $DEPLOY_DIR/secrets && chmod 400 $DEPLOY_DIR/secrets/firebase-sa.json"

  _env_has "^FIREBASE_PROJECT_ID=..*" || _env_write FIREBASE_PROJECT_ID "$FIREBASE_PROJECT"
  if _env_has "^FIREBASE_CREDENTIALS_PATH=..*"; then
    _env_has "^FIREBASE_CREDENTIALS_PATH=${FIREBASE_SA_PATH}\$" \
      || warn "FIREBASE_CREDENTIALS_PATH sunucuda farklı bir yolu gösteriyor — dokunulmadı"
  else
    _env_write FIREBASE_CREDENTIALS_PATH "$FIREBASE_SA_PATH"
  fi
  if _env_has "^PUSH_PROVIDER=firebase\$"; then
    ok "Push sağlayıcısı zaten firebase"
  elif _env_has "^PUSH_PROVIDER=\(mock\)\?\$" || ! _env_has "^PUSH_PROVIDER="; then
    _env_write PUSH_PROVIDER firebase
    ok "Push sağlayıcısı: mock → firebase"
  else
    warn "PUSH_PROVIDER sunucuda farklı bir değerde — dokunulmadı"
  fi
else
  warn "secrets/firebase-sa.json yok — push ayarlarına dokunulmadı"
fi

# ─── Volume dizinleri (node user uid 1000 için) ──────────────────────────────────────
# logs ve uploads bind-mount; container içindeki node user (uid 1000) yazabilmeli.
log "Volume dizinleri hazırlanıyor"
run_ssh "cd $DEPLOY_DIR && mkdir -p logs uploads backups/mysql && chown -R 1000:1000 logs uploads"
ok "Volume dizinleri hazır"

# ─── Yedek cron'u (scripts/backup.sh) ──────────────────────────────────────────
# Dosya her deploy'da baştan yazılır: tekrar çalıştırmak satırı çoğaltmaz.
# Kaldırmak: sunucuda rm /etc/cron.d/ogm-backup (ve bu adımı çıkarın, yoksa geri gelir).
log "Yedek cron'u kuruluyor (her gece 03:30 → backups/backup.log)"
run_ssh "echo '30 3 * * * root /bin/bash $DEPLOY_DIR/scripts/backup.sh >> $DEPLOY_DIR/backups/backup.log 2>&1' > /etc/cron.d/ogm-backup && chmod 644 /etc/cron.d/ogm-backup"
if run_ssh "systemctl is-active --quiet cron || systemctl is-active --quiet crond"; then
  ok "Yedek cron'u: /etc/cron.d/ogm-backup"
else
  warn "cron servisi çalışmıyor — yedek otomatik ALINMAZ (apt-get install cron)"
fi

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

# ─── Migration öncesi yedek (sadece update) ──────────────────────────────────────
# Migration'lar mevcut veriyi değiştirebilir (backfill, kolon değişikliği) ve MySQL'de
# yarıda kalan DDL geri alınmaz: önce yedek alınır, alınamazsa migration çalışmaz.
if [ "$MODE" = "update" ]; then
  log "Migration öncesi yedek (scripts/backup.sh → backups/backup.log)"
  run_ssh "/bin/bash $DEPLOY_DIR/scripts/backup.sh >> $DEPLOY_DIR/backups/backup.log 2>&1" \
    || die "Yedek alınamadı — migration çalıştırılmadı. Ayrıntı: sunucuda $DEPLOY_DIR/backups/backup.log"
  ok "Yedek alındı"
fi

# ─── docker compose up (build + start) ──────────────────────────────────────────────
# Dockerfile artık npm ci yapmıyor; sadece COPY ediyor. Build hızlı (~30sn).
# Güncellemede şema, yeni kod trafik almadan önce yeni imajla taşınır; aksi halde
# healthy beklenirken yeni kod henüz olmayan kolonlara yazar (ör. POST /sos).
if [ "$MODE" = "update" ]; then
  log "Knex migration (yeni kod başlamadan önce)"
  run_ssh "cd $DEPLOY_DIR && docker compose build backend && docker compose run --rm --no-deps -T backend npx knex migrate:latest"
  ok "Migration tamam"
fi

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

# Push sağlayıcısının gerçekten başladığını açılış logundan doğrula — anahtar
# bozuk/okunamaz ise deploy "başarılı" görünürken acil bildirimler gitmez.
PUSH_BROKEN=0
PUSH_BOOT_LINE=$(run_ssh "cd $DEPLOY_DIR && docker compose logs --tail 300 backend 2>/dev/null | grep 'Push sağlayıcısı' | tail -1" || true)
case "$PUSH_BOOT_LINE" in
  *GİTMEYECEK*)
    err "Push sağlayıcısı başlatılamadı — bildirimler GİTMEYECEK: $PUSH_BOOT_LINE"
    PUSH_BROKEN=1 ;;
  *firebase*) ok "Push: firebase aktif" ;;
  *mock*) warn "Push: mock (gerçek bildirim gönderilmez)" ;;
  *) warn "Push sağlayıcısı durumu logda görülemedi" ;;
esac

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
  log "Güncelleme modu: genel seed atlandı (mevcut data korunuyor)"
  # forest_units katalog verisi onboarding egitim doğrulaması için ZORUNLU ve
  # seed'i idempotent (onConflict('id').ignore(), .del() yok) — mevcut veriyi
  # ezmeden güncelleme modunda da güvenle çalıştırılabilir. Çalıştırılmazsa
  # tablo boş kalır ve her egitim'li kayıt 400 alır.
  log "Knex seed: 07_forest_units (idempotent katalog)"
  run_ssh "cd $DEPLOY_DIR && docker compose exec -T backend npx knex seed:run --specific=07_forest_units.js"
  ok "forest_units seed tamam"
fi

# ─── nginx config ──────────────────────────────────────────────
# nginx.conf tek dosya olarak bind-mount: rsync dosyayı yeni inode'la değiştirir,
# çalışan container eskisini görmeye devam eder ve compose up nginx'i yeniden
# yaratmaz. İçerik farklıysa yeni config tek seferlik container'da doğrulanır,
# sonra nginx yeniden yaratılır. Geri alma: nginx.conf'u geri alıp tekrar deploy.
if run_ssh "cd $DEPLOY_DIR && docker exec ogm-nginx cat /etc/nginx/nginx.conf 2>/dev/null | cmp -s - docker/nginx/nginx.conf"; then
  ok "nginx config değişmemiş"
else
  log "nginx config değişmiş — doğrulanıyor (nginx -t)"
  run_ssh "cd $DEPLOY_DIR && docker compose run --rm --no-deps -T nginx nginx -t" \
    || die "Yeni nginx.conf geçersiz — çalışan nginx'e dokunulmadı"
  run_ssh "cd $DEPLOY_DIR && docker compose up -d --no-deps --force-recreate nginx"
  ok "nginx yeni config ile yeniden yaratıldı"
fi

# ─── Smoke test ──────────────────────────────────────────────
# Backend'e nginx'i atlayarak 127.0.0.1:3000'den bakılır: domain kurulduktan
# sonra :80 301 döner ve curl -f 3xx'i hata saymaz. Container "healthy" yalnızca
# /health (liveness) demek; DB/Redis'i /health/ready ölçer, 503 = degraded.
log "Smoke test"
READY=""
for _ in $(seq 1 10); do
  READY=$(run_ssh "curl -sS --max-time 10 http://127.0.0.1:3000/health/ready" 2>&1 || true)
  case "$READY" in *'"status":"ok"'*) break ;; esac
  sleep 3
done
case "$READY" in
  *'"status":"ok"'*) ok "  /health/ready: ok" ;;
  *) die "Smoke test: /health/ready hazır değil → ${READY:-yanıt yok}" ;;
esac

REF_CODE=$(run_ssh "curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/v1/reference/kan-grubu" || true)
[ "$REF_CODE" = "200" ] || die "Smoke test: /v1/reference/kan-grubu → HTTP ${REF_CODE:-yok}"
ok "  /v1/reference/kan-grubu: 200"

# nginx üzerinden: https'e geçilmişse API_URL'e (hairpin NAT'a takılmasın diye
# 127.0.0.1'e çözülerek), değilse :80'e. Yönlendirme izlenmez; tam 200 beklenir.
API_URL_SRV=$(_env_get_url API_URL || true)
case "$API_URL_SRV" in
  https://*)
    NGINX_HOST=${API_URL_SRV#https://}; NGINX_HOST=${NGINX_HOST%%/*}; NGINX_HOST=${NGINX_HOST%%:*}
    NGINX_CURL="--resolve $NGINX_HOST:443:127.0.0.1 https://$NGINX_HOST/health" ;;
  *) NGINX_CURL="http://localhost/health" ;;
esac
NGINX_CODE=$(run_ssh "curl -sS -o /dev/null -w '%{http_code}' --max-redirs 0 --max-time 10 $NGINX_CURL" || true)
[ "$NGINX_CODE" = "200" ] || die "Smoke test: nginx ($NGINX_CURL) → HTTP ${NGINX_CODE:-yok}"
ok "  nginx /health: 200"
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
OFFICER_API_KEY=$OFFICER_API_KEY
SCAN_HMAC_SECRET=$SCAN_HMAC_SECRET
\`\`\`

> **Admin paneli** \`POST /v1/admin/auth/login\` ile girer (ilk süper admin: \`npm run super-admin:create\`); **saha amiri** \`x-api-key: <OFFICER_API_KEY>\` header'ı ile çağırır.

## Devre dışı entegrasyonlar (mock/empty mode)

| Entegrasyon | Durum | Aktifleştirmek için |
|---|---|---|
| SMS | mock (OTP log'a yazılır) | \`SMS_PROVIDER=netgsm\` + \`SMS_API_KEY\`, \`SMS_API_SECRET\` |
| e-Devlet | mock | \`EDEVLET_MOCK_MODE=false\` + \`EDEVLET_CLIENT_ID/SECRET\` |
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

# Kod yayında ama acil bildirimler gitmiyorsa deploy "başarılı" bitmemeli.
if [ "$PUSH_BROKEN" = "1" ]; then
  die "Deploy tamamlandı ama push sağlayıcısı başlatılamadı — secrets/firebase-sa.json'ı ve .env'deki FIREBASE_* değerlerini kontrol edin"
fi

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
