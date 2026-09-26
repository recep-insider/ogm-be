'use strict';

// Yüz yüze (`delivery = 'yuzyuze'`) teorik eğitimlerin oturum bilgisi: tarih-saat, yer ve
// eğitmen. Mobil bu alanlar doluysa kartta oturum detayını gösterir. Hepsi opsiyonel —
// online eğitimler ve bilgisi girilmemiş kayıtlar için null kalır.
exports.up = async function up(knex) {
  await knex.schema.alterTable('online_trainings', (t) => {
    t.datetime('session_starts_at').nullable();
    t.string('session_location', 200).nullable();
    t.string('session_instructor', 120).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('online_trainings', (t) => {
    t.dropColumn('session_starts_at');
    t.dropColumn('session_location');
    t.dropColumn('session_instructor');
  });
};
