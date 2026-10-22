'use strict';

// Üretimdeki üç seed olayı il/ilçe alanları eklenmeden önce yüklendi; il boş kaldığı için
// bölge süzmesi (il'den eşleşir) onları gizliyor. Değerler seeds/05_missions.js ile aynı.
// Yalnız il'i hâlâ boş olan satır güncellenir — elle girilmiş il ezilmez.
const MISSIONS = [
  { id: 'am_marmaris', il: 'Muğla', ilce: 'Marmaris' },
  { id: 'am_fethiye', il: 'Muğla', ilce: 'Fethiye' },
  { id: 'fm_marmaris_2025', il: 'Muğla', ilce: 'Marmaris' },
];

exports.up = async function up(knex) {
  for (const m of MISSIONS) {
    // eslint-disable-next-line no-await-in-loop
    await knex('missions')
      .where({ id: m.id })
      .where((q) => q.whereNull('il').orWhere('il', ''))
      .update({ il: m.il, ilce: m.ilce });
  }
};

// Geri alma yalnız hâlâ bu adımın yazdığı değerleri taşıyan satırları boşaltır.
exports.down = async function down(knex) {
  for (const m of MISSIONS) {
    // eslint-disable-next-line no-await-in-loop
    await knex('missions').where({ id: m.id, il: m.il, ilce: m.ilce }).update({ il: null, ilce: null });
  }
};
