#!/usr/bin/env bash
# UAT raporlarını sunucudan CSV olarak bilgisayara indirir.
#
# Kullanım (yerelde, repo kökünde):
#   ./scripts/uat-rapor.sh [klasör]
# Parola SSHPASS'tan okunur, yoksa sorulur. Klasör verilmezse ~/uat-rapor-<tarih> kullanılır.
set -euo pipefail

TARGET=${TARGET:-root@185.22.187.88}
DEPLOY_DIR=${DEPLOY_DIR:-/opt/ogm-gonullu}
OUT=${1:-$HOME/uat-rapor-$(date +%Y%m%d-%H%M)}

command -v sshpass >/dev/null || { echo "sshpass yok. Kur: brew install hudochenkov/sshpass/sshpass" >&2; exit 1; }

if [ -z "${SSHPASS:-}" ]; then
  read -rsp "SSH parolası ($TARGET): " SSHPASS
  echo
fi
[ -n "$SSHPASS" ] || { echo "Parola boş olamaz." >&2; exit 1; }
export SSHPASS

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p "${SSH_PORT:-22}")

mkdir -p "$OUT"
for pair in html:rapor.html screens:ekranlar.csv raw:ham.csv pages:sayfalar.csv fields:alanlar.csv \
  actions:islemler.csv people:kisiler.csv messages:mesajlar.csv; do
  # npm run değil node: npm'in başlık satırı rapora karışır.
  sshpass -e ssh "${SSH_OPTS[@]}" "$TARGET" \
    "cd $DEPLOY_DIR && docker compose exec -T backend node scripts/export-uat-events.js ${pair%%:*}" \
    > "$OUT/${pair#*:}"
done

echo "Raporlar: $OUT"
if command -v open >/dev/null; then open "$OUT/rapor.html"; fi
