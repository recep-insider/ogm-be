#!/usr/bin/env node
'use strict';

// KVKK — silme talebinin üzerinden 30 gün geçen hesapların kişisel verilerini
// anonimleştirir. API süreci aynı işi açılışta ve saatte bir kendisi yapar
// (src/server.js); bu script elle tetiklemek içindir. Kilit ortaktır, iki koşu çakışmaz.
//
// Kullanım (sunucuda):
//   docker compose exec -T backend npm run kvkk:anonymize

async function main() {
  const { db } = require('../src/config/db');
  const { closeRedis } = require('../src/config/redis');
  const { runExclusive } = require('../src/modules/users/anonymize.service');
  try {
    const result = await runExclusive();
    if (result.skipped) {
      console.log('Başka bir anonimleştirme koşusu sürüyor; bu çağrı atlandı.');
      return;
    }
    console.log(`Süresi dolan hesap: ${result.due}, anonimleştirilen: ${result.anonymized}, başarısız: ${result.failed.length}`);
    if (result.failed.length) {
      console.error(`Başarısız hesaplar: ${result.failed.join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await db.destroy();
    await closeRedis();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Anonimleştirme çalıştırılamadı:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
