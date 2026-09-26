'use strict';

// Mobil, Firebase SDK'sı bağlanana kadar cihazları `stub-` önekli sahte token'larla
// kaydediyordu. Bunlara hiçbir push ulaşamaz ve gerçek sağlayıcıda her gönderim
// geçersiz-token hatası üretir. Yeni sürüm açılışta gerçek FCM token'ını kaydeder;
// eski kayıtlar silinir. Geri alınamaz (anlamlı bir veri de yoktur) — down boş.
exports.up = async function up(knex) {
  await knex('devices').where('fcm_token', 'like', 'stub-%').del();
};

exports.down = async function down() {};
