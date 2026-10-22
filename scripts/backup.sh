#!/usr/bin/env bash
#
# OGM Gönüllü — Günlük yedek (sunucuda, root)
#
# Kullanım:
#   /opt/ogm-gonullu/scripts/backup.sh
#
# deploy.sh bunu /etc/cron.d/ogm-backup ile her gece 03:30'da çalıştırır;
# çıktı backups/backup.log'a eklenir.
#
# Script yaptıkları:
#   1. MySQL: mysqldump --single-transaction → backups/mysql/ogm-<zaman>.sql.gz
#   2. uploads/ → backups/uploads/<zaman>/ (rsync --link-dest: değişmeyen dosyalar
#      bir önceki görüntüye hardlink, disk yalnızca yeni/değişen dosya kadar büyür)
#   3. 14 günden eski yedekleri siler (yalnızca bu yedek başarılıysa)

set -euo pipefail

DEPLOY_DIR=/opt/ogm-gonullu
BACKUP_DIR="$DEPLOY_DIR/backups"
UP_DIR="$BACKUP_DIR/uploads"
KEEP_DAYS=14
MYSQL_CONTAINER=ogm-mysql
STAMP=$(date +%F_%H%M%S)
DUMP="$BACKUP_DIR/mysql/ogm-$STAMP.sql.gz"

log() { printf '%s ▶ %s\n' "$(date '+%F %T')" "$*"; }
die() { printf '%s ✗ %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

# Yedekler kişisel veri içerir: yalnızca root okuyabilsin.
umask 077
mkdir -p "$BACKUP_DIR/mysql" "$UP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || die "Başka bir yedek çalışıyor"
cleanup() {
  local rc=$?
  rm -f "$DUMP.tmp"
  [ "$rc" = 0 ] || die "Yedek BAŞARISIZ (çıkış kodu $rc)"
}
trap cleanup EXIT

# İlk uploads görüntüsü uploads/ kadar yer ister. Disk dolarsa MySQL yazamaz.
PREV=""
for d in "$UP_DIR"/[0-9]*/; do [ -d "$d" ] && PREV="$d"; done
NEED_KB=0
[ -n "$PREV" ] || NEED_KB=$(du -sk "$DEPLOY_DIR/uploads" | cut -f1)
AVAIL_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2{print $4}')
[ "$AVAIL_KB" -gt $((NEED_KB + 1048576)) ] \
  || die "Diskte yer yok: ${AVAIL_KB}KB boş, ${NEED_KB}KB + 1GB pay gerekli — yedek alınmadı"

# Parola mysql container'ının kendi ortamından (compose → .env DB_ROOT_PASSWORD)
# okunur; host'ta komut satırına düşmez. --databases yok: dump USE içermez,
# restore-check onu ayrı bir veritabanına güvenle yükler.
log "MySQL dump → $DUMP"
# shellcheck disable=SC2016
docker exec "$MYSQL_CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot \
  --single-transaction --quick --routines --triggers --events --no-tablespaces "$MYSQL_DATABASE"' \
  | gzip > "$DUMP.tmp"
gzip -t "$DUMP.tmp"
mv "$DUMP.tmp" "$DUMP"
log "MySQL dump tamam ($(du -h "$DUMP" | cut -f1))"

log "uploads görüntüsü → $UP_DIR/$STAMP${PREV:+ (fark: $PREV)}"
rm -rf "$UP_DIR/.partial"
rsync -a ${PREV:+--link-dest="$PREV"} "$DEPLOY_DIR/uploads/" "$UP_DIR/.partial/"
mv "$UP_DIR/.partial" "$UP_DIR/$STAMP"
# rsync -a dizin zamanını kaynaktan kopyalar; saklama süresi yedek zamanına göre işlesin.
touch "$UP_DIR/$STAMP"
log "uploads görüntüsü tamam"

log "$KEEP_DAYS günden eski yedekler siliniyor"
find "$BACKUP_DIR/mysql" -maxdepth 1 -name 'ogm-*.sql.gz' -mtime +$((KEEP_DAYS - 1)) -print -delete
find "$UP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' -mtime +$((KEEP_DAYS - 1)) -print -exec rm -rf {} +

log "Yedek tamam (disk: $(df -h "$BACKUP_DIR" | awk 'NR==2{print $4}') boş)"
