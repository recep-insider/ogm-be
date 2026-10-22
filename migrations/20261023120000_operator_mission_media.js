'use strict';

// Operatörün panelden yüklediği olay medyası: gönüllüsü yoktur (user_id null), yükleyen panel kullanıcısıdır.
exports.up = async function up(knex) {
  await knex.schema.alterTable('mission_photos', (t) => {
    t.string('user_id', 36).nullable().alter();
    t.string('panel_user_id', 36).nullable().references('id').inTable('panel_users').onDelete('SET NULL');
  });
};

exports.down = async function down(knex) {
  // user_id tekrar zorunlu olacağı için gönüllüsüz (operatör) satırlar önce silinir.
  await knex('mission_photos').whereNull('user_id').del();
  await knex.schema.alterTable('mission_photos', (t) => {
    t.dropForeign(['panel_user_id']);
    t.dropColumn('panel_user_id');
  });
  await knex.schema.alterTable('mission_photos', (t) => {
    t.string('user_id', 36).notNullable().alter();
  });
};
