#!/usr/bin/env node
'use strict';

// SOS'un bölgesi çağrının basıldığı yerden türer (sos_reports.il/ilce). Bu alanlar
// eklenmeden önce açılan ve oluşturma anında konumu çözülemeyen çağrılar için kayıtlı
// lat/lng üzerinden il/ilçe'yi doldurur. Yalnızca il'i boş ve koordinatı olan satırlar
// alınır; her satır ayrı yazıldığından yarıda kesilen koşu yeniden çalıştırılınca
// kaldığı yerden devam eder.
//
// Kullanım (sunucuda):
//   docker compose exec -T backend npm run backfill:sos-locations
//   docker compose exec -T backend npm run backfill:sos-locations -- --dry-run
//
// --dry-run kapsamı listeler, geocode isteği ATMAZ. Koordinat kişisel veri olduğundan
// çıktıya yalnızca kayıt id'si yazılır.
//
// İstekler shared/reverse-geocode.js'teki throttle ile saniyede 1'e sınırlıdır (public
// OSM politikası). Throttle process başınadır; API ile aynı IP'den toplam hız 2/sn'ye
// çıkabilir — düşük trafikli pencerede çalıştır.

const { db } = require('../src/config/db');
const { reverseGeocode } = require('../src/shared/reverse-geocode');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const rows = await db('sos_reports')
    .whereNull('il')
    .whereNotNull('lat')
    .whereNotNull('lng')
    .select('id', 'lat', 'lng');

  console.log(`${rows.length} kayıt güncellenecek${DRY_RUN ? ' (dry-run)' : ''}`);

  if (DRY_RUN) {
    for (const row of rows) console.log(`  ${row.id}: geocode edilecek`);
    console.log(`Dry-run: ${rows.length} kayıt geocode edilecekti, istek atılmadı.`);
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const { il, ilce } = await reverseGeocode(Number(row.lat), Number(row.lng));

    if (!il) {
      failed += 1;
      console.warn(`  ${row.id}: il çözülemedi — atlandı`);
      continue;
    }

    // API'nin arka plan doldurması bu arada yazdıysa ezilmez.
    await db('sos_reports').where({ id: row.id }).whereNull('il').update({ il, ilce, updated_at: new Date() });
    updated += 1;
    console.log(`  ${row.id}: ${[il, ilce].filter(Boolean).join(' / ')}`);
  }

  console.log(`Bitti: ${updated} güncellendi, ${failed} başarısız.`);

  // Servis erişilemezse her satır il'siz döner; sıfır güncellemeyle 0 çıkışı temiz
  // koşudan ayırt edilemezdi (koordinat adres döndürmemiş de olabilir).
  if (rows.length > 0 && updated === 0) {
    console.error(
      'Hiçbir kayıt güncellenemedi — NOMINATIM_URL/servis erişimini kontrol edin ' +
        '(ya da koordinatların hiçbiri il döndürmemiş olabilir).'
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
