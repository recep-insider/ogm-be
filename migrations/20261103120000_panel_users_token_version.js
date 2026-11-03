'use strict';

// Çıkış ve şifre değişimi sürümü artırır; daha eski sürümle imzalanmış panel access token'ları reddedilir.
exports.up = async function up(knex) {
  await knex.schema.alterTable('panel_users', (t) => {
    t.integer('token_version').unsigned().notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('panel_users', (t) => {
    t.dropColumn('token_version');
  });
};
