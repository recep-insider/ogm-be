'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('forest_units', (t) => {
    t.string('id', 100).primary();
    t.string('il', 50).notNullable();
    t.string('ilce', 60).notNullable();
    t.string('bolge_mudurlugu', 100).notNullable();
    t.string('isletme_mudurlugu', 100).notNullable();
    t.timestamps(true, true);
    t.unique(['il', 'ilce', 'isletme_mudurlugu']);
    t.index(['il', 'ilce']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('forest_units');
};
