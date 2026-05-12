-- OGM Gönüllü Yönetim Sistemi — Veritabanı bootstrap
-- MySQL container ilk açılışta `/docker-entrypoint-initdb.d/init.sql` olarak çalıştırır.

CREATE DATABASE IF NOT EXISTS `ogm_gonullu`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Uygulama kullanıcısı (compose tarafından MYSQL_USER ile zaten oluşturulur,
-- buradaki GRANT ekstra güvenlik için sadece ilgili veritabanı üzerinde yetki tanımlar).
GRANT ALL PRIVILEGES ON `ogm_gonullu`.* TO 'ogm_app'@'%';

-- Test veritabanı (Jest entegrasyon testleri için)
CREATE DATABASE IF NOT EXISTS `ogm_gonullu_test`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON `ogm_gonullu_test`.* TO 'ogm_app'@'%';

FLUSH PRIVILEGES;
