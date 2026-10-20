'use strict';

// Panel kullanıcısının birimi işletme müdürlüğü düzeyinde; forest_units ilçe düzeyinde olduğu için
// tek satıra FK yerine bölge + işletme adı tutulur (çift talep anında forest_units'e karşı doğrulanır).
exports.up = async function up(knex) {
  await knex.schema.alterTable('panel_users', (t) => {
    t.dropForeign(['unit_id']);
  });
  await knex.schema.alterTable('panel_users', (t) => {
    t.dropColumn('unit_id');
    t.string('bolge_mudurlugu', 100).nullable();
    t.string('isletme_mudurlugu', 100).nullable();
    t.string('request_note', 500).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('panel_users', (t) => {
    t.dropColumn('request_note');
    t.dropColumn('isletme_mudurlugu');
    t.dropColumn('bolge_mudurlugu');
    t.string('unit_id', 100).nullable().references('id').inTable('forest_units').onDelete('SET NULL');
  });
};
