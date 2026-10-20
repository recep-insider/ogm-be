'use strict';

// SOS anında gönüllünün yolda/sahada olduğu aktif olay — yoksa null kalır (SOS herkese açık).
exports.up = async function up(knex) {
  await knex.schema.alterTable('sos_reports', (t) => {
    t.string('mission_id', 36).nullable().references('id').inTable('missions').onDelete('SET NULL');
    t.index(['mission_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('sos_reports', (t) => {
    t.dropForeign(['mission_id']);
    t.dropIndex(['mission_id']);
    t.dropColumn('mission_id');
  });
};
