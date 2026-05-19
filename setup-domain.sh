#!/usr/bin/env bash
#
# OGM Gönüllü — Domain & SSL Kurulum Script'i
#
# Kullanım:
#   ./setup-domain.sh <domain> <email>
#
# Örnek:
#   ./setup-domain.sh recepbiyikli.com benim@email.com
#
# Önkoşullar:
#   - Natro panelden recepbiyikli.com ve www.recepbiyikli.com için
#     A kaydı = 94.73.180.124 zaten yapılmış olmalı (propagate olmuş).
#   - deploy.sh ile sunucu kurulu ve çalışıyor olmalı.
#
# Script yaptıkları:
#   1. DNS doğrulama (dig)
#   2. Sunucuda certbot dizinlerini oluştur
#   3. Geçici Stage-1 nginx config (HTTP-only + ACME) gönder, nginx restart
#   4. Certbot Docker ile sertifika al
#   5. Asıl Stage-2 nginx config (HTTPS) gönder, nginx restart
#   6. .env'de URL'leri https'e çevir, backend restart
#   7. Cron job kur (otomatik yenileme)
#   8. Smoke test

set -euo pipefail

# ─── Argümanlar ──────────────────────────────────────────────
DOMAIN="${1:-}"
EMAIL="${2:-}"
TARGET="${TARGET:-root@94.73.180.124}"
DEPLOY_DIR=/opt/ogm-gonullu
LOCAL_REPO="$(cd "$(dirname "$0")" && pwd)"

[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || {
  echo "Kullanım: $0 <domain> <email>"
  echo "Örnek:    $0 recepbiyikli.com benim@email.com"
  exit 1
}

# TARGET'tan host + port
TARGET_HOST="${TARGET#*@}"
SSH_HOST="${TARGET_HOST%:*}"
SSH_PORT="22"
if [[ "$TARGET_HOST" == *:* ]]; then
  SSH_PORT="${TARGET_HOST##*:}"
  TARGET="${TARGET%:*}"
fi

# ─── Output ──────────────────────────────────────────────
log()  { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ─── Pre-flight ──────────────────────────────────────────────
log "Pre-flight kontrol"
command -v sshpass >/dev/null || die "sshpass yok. brew install hudochenkov/sshpass/sshpass"
command -v dig     >/dev/null || die "dig yok (genelde default kurulu)."
command -v scp     >/dev/null || die "scp yok."
[ -f "$LOCAL_REPO/docker/nginx/nginx.conf" ] || die "nginx.conf bulunamadı."
ok "Yerel araçlar tamam"

# ─── DNS doğrulama ──────────────────────────────────────────────
log "DNS kaydı doğrulanıyor"
EXPECTED_IP="$SSH_HOST"
RESOLVED=$(dig "$DOMAIN" +short A | head -1)
echo "  $DOMAIN  →  ${RESOLVED:-(boş)}"
if [ "$RESOLVED" != "$EXPECTED_IP" ]; then
  err "$DOMAIN $EXPECTED_IP'e işaret etmiyor."
  err "Natro'da A kaydını ekleyin. Sonra 5-15dk bekleyip tekrar deneyin."
  err "Kontrol:  dig $DOMAIN +short"
  exit 1
fi
ok "DNS doğru ($EXPECTED_IP)"

# ─── SSH parolası ──────────────────────────────────────────────
read -rsp "SSH parolası ($TARGET, port $SSH_PORT): " SSHPASS
echo
[ -n "$SSHPASS" ] || die "Parola boş olamaz."
export SSHPASS

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p "$SSH_PORT")
SCP_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -P "$SSH_PORT")
run_ssh() { sshpass -e ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
run_scp() { sshpass -e scp "${SCP_OPTS[@]}" "$@"; }

# ─── Bağlantı testi ──────────────────────────────────────────────
log "SSH bağlantısı test"
run_ssh 'echo connected' >/dev/null || die "SSH başarısız."
ok "Bağlantı OK"

# ─── Sunucuda certbot dizinleri ──────────────────────────────────────────────
log "Certbot dizinleri hazırlanıyor"
run_ssh "mkdir -p $DEPLOY_DIR/certbot/conf $DEPLOY_DIR/certbot/www"
ok "Dizinler hazır"

# ─── Geçici dizin ──────────────────────────────────────────────
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"; unset SSHPASS' EXIT
chmod 700 "$TMPDIR"

# ─── Stage 1 nginx config (HTTP-only + ACME) ──────────────────────────────────
log "Geçici nginx.conf (Stage 1 / HTTP-only) hazırlanıyor"
cat > "$TMPDIR/nginx.stage1.conf" <<EOF
user  nginx;
worker_processes  auto;
error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events { worker_connections  2048; }

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    server_tokens off;
    client_max_body_size 25m;
    gzip on;
    gzip_types application/json text/plain application/javascript text/css;

    upstream backend {
        least_conn;
        server backend:3000 max_fails=3 fail_timeout=15s;
        keepalive 32;
    }

    server {
        listen 80;
        server_name $DOMAIN;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }
}
EOF

# Önce mevcut yerel docker-compose.yml de sunucuda güncel olmalı (certbot volumes için)
log "docker-compose.yml sunucuya gönderiliyor (certbot volume mount'ları için)"
run_scp "$LOCAL_REPO/docker-compose.yml" "$TARGET:$DEPLOY_DIR/docker-compose.yml"
ok "docker-compose.yml güncel"

log "Stage 1 nginx config sunucuya gönderiliyor"
run_scp "$TMPDIR/nginx.stage1.conf" "$TARGET:$DEPLOY_DIR/docker/nginx/nginx.conf"
ok "Stage 1 config yerinde"

log "Nginx restart (Stage 1 config'i alsın)"
run_ssh "cd $DEPLOY_DIR && docker compose up -d nginx --force-recreate"
sleep 3

# Stage 1 doğrulaması
log "Stage 1 doğrulama — HTTP üzerinden ACME endpoint erişilebilir mi?"
HTTP_TEST=$(run_ssh "curl -fsS -o /dev/null -w '%{http_code}' http://localhost/health" || echo "000")
[ "$HTTP_TEST" = "200" ] || warn "HTTP /health = $HTTP_TEST (devam ediliyor)"

# ─── Certbot ile sertifika al ──────────────────────────────────────────────
log "Let's Encrypt sertifikası alınıyor (webroot challenge)"
run_ssh "docker run --rm \
  -v $DEPLOY_DIR/certbot/conf:/etc/letsencrypt \
  -v $DEPLOY_DIR/certbot/www:/var/www/certbot \
  certbot/certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email $EMAIL --agree-tos --no-eff-email --non-interactive \
    -d $DOMAIN" \
  || die "Certbot başarısız. Logları kontrol edin: docker compose logs nginx"

# Sertifika gerçekten oluştu mu?
run_ssh "[ -f $DEPLOY_DIR/certbot/conf/live/$DOMAIN/fullchain.pem ]" \
  || die "fullchain.pem oluşturulamadı."
ok "Sertifika alındı"

# ─── Stage 2 nginx config (yerel, kalıcı versiyon) ──────────────────────────────
log "Asıl nginx.conf (Stage 2 / HTTPS) sunucuya gönderiliyor"
run_scp "$LOCAL_REPO/docker/nginx/nginx.conf" "$TARGET:$DEPLOY_DIR/docker/nginx/nginx.conf"
ok "Stage 2 config yerinde"

# ─── .env güncelle (https URL'leri) ──────────────────────────────────────────────
log ".env'de URL'ler https'e çevriliyor"
run_ssh "sed -i.bak \
  -e 's|^APP_URL=.*|APP_URL=https://$DOMAIN|' \
  -e 's|^API_URL=.*|API_URL=https://$DOMAIN|' \
  -e 's|^EDEVLET_CALLBACK_URL=.*|EDEVLET_CALLBACK_URL=https://$DOMAIN/v1/auth/edevlet/callback|' \
  $DEPLOY_DIR/.env"
ok ".env güncel"

# ─── Restart ──────────────────────────────────────────────
log "nginx + backend restart"
run_ssh "cd $DEPLOY_DIR && docker compose up -d nginx backend --force-recreate"
sleep 5
ok "Restart tamam"

# ─── Cron — otomatik yenileme ──────────────────────────────────────────────
log "Cron job kuruluyor (her gece 03:00 sertifika yenileme)"
CRON_CONTENT="0 3 * * * root docker run --rm -v $DEPLOY_DIR/certbot/conf:/etc/letsencrypt -v $DEPLOY_DIR/certbot/www:/var/www/certbot certbot/certbot renew --quiet && docker exec ogm-nginx nginx -s reload"
run_ssh "echo '$CRON_CONTENT' > /etc/cron.d/certbot-renew && chmod 644 /etc/cron.d/certbot-renew"
ok "Cron kuruldu"

# ─── Smoke test ──────────────────────────────────────────────
log "Smoke test"
echo -n "  HTTP redirect:    "
REDIRECT=$(curl -sI "http://$DOMAIN/" | grep -i '^location:' | tr -d '\r' || true)
echo "${REDIRECT:-yok}"

echo -n "  HTTPS health:     "
HEALTH=$(curl -fsS "https://$DOMAIN/health" 2>&1 || echo "BAŞARISIZ")
echo "$HEALTH"

echo -n "  Reference data:   "
REF=$(curl -fsS "https://$DOMAIN/v1/reference/kan-grubu" 2>&1 | head -c 100 || echo "BAŞARISIZ")
echo "$REF..."

echo -n "  Sertifika expiry: "
EXPIRY=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "okunamadı")
echo "$EXPIRY"

# ─── Özet ──────────────────────────────────────────────
echo
ok "═══════════════════════════════════════════════════════"
ok "Domain + SSL kurulum tamamlandı"
ok "═══════════════════════════════════════════════════════"
echo
echo "  Domain    : https://$DOMAIN"
echo "  Swagger   : https://$DOMAIN/docs"
echo "  Health    : https://$DOMAIN/health"
echo
echo "  Sertifika : 90 gün geçerli, cron otomatik yeniliyor"
echo "  Cron file : /etc/cron.d/certbot-renew (sunucuda)"
echo
echo "  SSL Labs testi (opsiyonel):"
echo "    https://www.ssllabs.com/ssltest/analyze.html?d=$DOMAIN"
echo
