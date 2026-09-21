'use strict';

// mobil-gereksinimleri.md §15 — "Alınan Eğitimler" listesi YOKLAMADAN gelmeli; elle
// işaretlenen bir "tamamladım" olmamalı. Tek kaynak: teorik için tamamlama kaydı
// (online_training_progress), uygulamalı için yetkinlik bayraklı saha eğitiminin
// yoklaması (saha_training_applications.attendance). Sertifika bu iki kayda bağlanır —
// `user_trainings` tablosu elle doldurulan bir kopya olduğu için artık okunmuyor.
exports.up = async function up(knex) {
  await knex.schema.alterTable('online_training_progress', (t) => {
    t.string('certificate_path', 512).nullable();
  });
  await knex.schema.alterTable('saha_training_applications', (t) => {
    t.string('certificate_path', 512).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('online_training_progress', (t) => {
    t.dropColumn('certificate_path');
  });
  await knex.schema.alterTable('saha_training_applications', (t) => {
    t.dropColumn('certificate_path');
  });
};
