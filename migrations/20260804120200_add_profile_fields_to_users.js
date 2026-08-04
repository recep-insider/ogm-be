'use strict';

exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('giysi_bedeni', 8).nullable();
    t.integer('ayakkabi_numarasi').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('giysi_bedeni');
    t.dropColumn('ayakkabi_numarasi');
  });
};
