#!/usr/bin/env bash
#
# OGM Gönüllü — Yedek geri yükleme denetimi (sunucuda, root)
#
# Kullanım:
#   /opt/ogm-gonullu/scripts/restore-check.sh
#
# En son backups/mysql/ogm-*.sql.gz dosyasını AYRI bir geçici veritabanına
# (ogm_restore_check) yükler, sanity sorgusu çalıştırır ve veritabanını siler.
# Canlı veritabanına yazmaz. Aynı MySQL'i kullandığı için yoğun saatte çalıştırmayın.

set -euo pipefail

DEPLOY_DIR=/opt/ogm-gonullu
MYSQL_CONTAINER=ogm-mysql
CHECK_DB=ogm_restore_check

log()  { printf '%s ▶ %s\n' "$(date '+%F %T')" "$*"; }
ok()   { printf '%s ✓ %s\n' "$(date '+%F %T')" "$*"; }
warn() { printf '%s ! %s\n' "$(date '+%F %T')" "$*"; }
die()  { printf '%s ✗ %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

# Parola backup.sh'deki gibi mysql container'ının kendi ortamından okunur.
# shellcheck disable=SC2016
mysql_root() { docker exec -i "$MYSQL_CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$@"' sh "$@"; }

DUMP=""
for f in "$DEPLOY_DIR"/backups/mysql/ogm-*.sql.gz; do [ -f "$f" ] && DUMP="$f"; done
[ -n "$DUMP" ] || die "Dump bulunamadı: $DEPLOY_DIR/backups/mysql/ogm-*.sql.gz"
log "Dump: $DUMP ($(du -h "$DUMP" | cut -f1))"
[ -z "$(find "$DUMP" -mmin +1560)" ] || warn "En son dump 26 saatten eski — cron çalışıyor mu? (backups/backup.log)"

# root ile yüklendiği için USE / CREATE DATABASE içeren bir dump canlı veritabanına yazar.
if zgrep -qE '^(USE|CREATE DATABASE) ' "$DUMP"; then
  die "Dump USE/CREATE DATABASE içeriyor — canlı veritabanına yazabileceği için yüklenmedi"
fi

cleanup() {
  local rc=$?
  if mysql_root -e "DROP DATABASE IF EXISTS $CHECK_DB"; then
    log "Geçici veritabanı silindi ($CHECK_DB)"
  else
    warn "$CHECK_DB silinemedi — elle silin"
  fi
  [ "$rc" = 0 ] || die "Restore denetimi BAŞARISIZ (çıkış kodu $rc)"
}
trap cleanup EXIT
mysql_root -e "DROP DATABASE IF EXISTS $CHECK_DB; CREATE DATABASE $CHECK_DB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

log "Yükleniyor → $CHECK_DB"
# sql_log_bin=0: deneme yüklemesi binlog'u şişirmesin.
{ echo 'SET sql_log_bin=0;'; gunzip -c "$DUMP"; } | mysql_root "$CHECK_DB"

LIVE_DB=$(docker exec "$MYSQL_CONTAINER" printenv MYSQL_DATABASE)
TABLES=$(mysql_root -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$CHECK_DB'")
LIVE_TABLES=$(mysql_root -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$LIVE_DB'")
MIGRATIONS=$(mysql_root -e "SELECT COUNT(*) FROM \`$CHECK_DB\`.knex_migrations")
USERS=$(mysql_root -e "SELECT COUNT(*) FROM \`$CHECK_DB\`.users")
LIVE_USERS=$(mysql_root -e "SELECT COUNT(*) FROM \`$LIVE_DB\`.users")

echo "  Tablo     : $TABLES (canlı: $LIVE_TABLES)"
echo "  Migration : $MIGRATIONS"
echo "  Kullanıcı : $USERS (canlı: $LIVE_USERS)"
[ "$TABLES" -gt 0 ] && [ "$MIGRATIONS" -gt 0 ] || die "Restore denetimi BAŞARISIZ: tablo ya da migration yok"
[ "$TABLES" = "$LIVE_TABLES" ] || warn "Tablo sayısı canlıdan farklı (dump'tan sonra migration çalışmış olabilir)"
ok "Restore denetimi geçti"
