'use strict';

// Doğrulama 1000 karaktere izin veriyordu, sütun 500'dü: 501–1000 karakterlik ihbar 500 ile kayboluyordu.
exports.up = async function up(knex) {
  await knex.schema.alterTable('fire_reports', (t) => {
    t.string('description', 1000).nullable().alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('fire_reports', (t) => {
    t.string('description', 500).nullable().alter();
  });
};
