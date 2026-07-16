#!/usr/bin/env node
'use strict';

// NOMINATIM_URL tanımsızken oluşturulan ihbarların location_name/region_label
// alanları 'Bilinmeyen Konum' + koordinat metni olarak kaydedildi. Bu script
// kayıtlı latitude/longitude üzerinden tekrar reverse geocode edip günceller.
//
// Kullanım (sunucuda):
//   docker compose exec -T backend npm run backfill:locations
//   docker compose exec -T backend npm run backfill:locations -- --dry-run
//
// --dry-run kapsamı listeler, geocode isteği ATMAZ (koordinat kişisel veri).
//
// İstekler shared/reverse-geocode.js'teki throttle ile saniyede 1'e sınırlıdır
// (public OSM politikası) — kayıt sayısı kadar saniye sürer. DİKKAT: throttle
// process başınadır; bu script API'den ayrı process olduğu için aynı IP'den
// eşzamanlı ihbar trafiğiyle toplam hız 2/sn'ye çıkar. Düşük trafikli
// pencerede çalıştır.

const { db } = require('../src/config/db');
const { reverseGeocode, PLACEHOLDER } = require('../src/shared/reverse-geocode');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const rows = await db('fire_reports')
    .where((qb) => qb.where('location_name', PLACEHOLDER).orWhere('location_name', '').orWhereNull('location_name'))
    .select('id', 'latitude', 'longitude', 'location_name');

  console.log(`${rows.length} kayıt güncellenecek${DRY_RUN ? ' (dry-run)' : ''}`);

  // Dry-run hiçbir koordinatı dışarı sızdırmaz: geocode isteği de atılmaz,
  // yalnızca kapsam listelenir.
  if (DRY_RUN) {
    for (const row of rows) {
      console.log(`  ${row.id}: (${row.latitude}, ${row.longitude}) → geocode edilecek`);
    }
    console.log(`Dry-run: ${rows.length} kayıt geocode edilecekti, istek atılmadı.`);
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    const { locationName, regionLabel } = await reverseGeocode(lat, lng);

    if (locationName === PLACEHOLDER) {
      failed += 1;
      console.warn(`  ${row.id}: geocode başarısız (${lat}, ${lng}) — atlandı`);
      continue;
    }

    await db('fire_reports')
      .where({ id: row.id })
      .update({ location_name: locationName, region_label: regionLabel, updated_at: new Date() });
    updated += 1;
    console.log(`  ${row.id}: ${locationName} — ${regionLabel}`);
  }

  console.log(`Bitti: ${updated} güncellendi, ${failed} başarısız.`);

  // Servis erişilemezse her satır placeholder'a düşer ve script hiçbir şey
  // yapmadan 0 ile çıkardı — temiz koşudan ayırt edilemiyordu.
  // Not: placeholder "servis kapalı" ile "koordinat gerçekten adres döndürmedi"
  // (adressiz kırsal nokta — orman yangınında olağan) arasında ayrım yapmaz;
  // mesaj bu yüzden ikisini de kapsıyor.
  if (rows.length > 0 && updated === 0) {
    console.error(
      'Hiçbir kayıt güncellenemedi — NOMINATIM_URL/servis erişimini kontrol edin ' +
        '(ya da koordinatların hiçbiri adres döndürmemiş olabilir).'
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Backfill hatası:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
