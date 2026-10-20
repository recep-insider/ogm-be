'use strict';

// Toplanma noktasındaki sorumlu görevlinin adı ve telefonu — yalnızca panelde görünür,
// gönüllüye açılan mobil uçlara konmaz.
exports.up = async function up(knex) {
  await knex.schema.alterTable('assembly_points', (t) => {
    t.string('officer_name', 120).nullable();
    t.string('officer_phone', 20).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('assembly_points', (t) => {
    t.dropColumn('officer_name');
    t.dropColumn('officer_phone');
  });
};
