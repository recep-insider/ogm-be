'use strict';

// Üretimdeki üç seed olayı il/ilçe alanları eklenmeden önce yüklendi; il boş kaldığı için
// bölge süzmesi (il'den eşleşir) onları gizliyor. Değerler seeds/05_missions.js ile aynı.
// Yalnız il ve ilçesi ikisi de boş olan satır güncellenir (seed'in yeniden doldurmasıyla aynı
// koşul) — elle girilmiş il ya da ilçe ezilmez.
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
      .where((q) => q.whereNull('ilce').orWhere('ilce', ''))
      .update({ il: m.il, ilce: m.ilce });
  }
};

// Geri alınmaz: aynı değerler seed'den ya da panelden de gelmiş olabilir; hangisinin bu
// adımdan geldiği bilinemediği için boşaltmak meşru veriyi silebilir.
exports.down = async function down() {};
