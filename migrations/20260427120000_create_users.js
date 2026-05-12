'use strict';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.string('id', 36).primary();
    t.string('tc_kimlik', 11).unique();
    t.string('ad', 100);
    t.string('soyad', 100);
    t.date('dogum_tarihi');
    t.string('phone', 20).unique();
    t.string('eposta', 254);
    t.text('adres');
    t.string('kan_grubu', 4);
    t.string('ogrenim', 32);
    t.string('meslek', 32);
    t.string('meslek_diger', 100);
    t.json('hobiler');
    t.string('acil_ad', 100);
    t.string('acil_soyad', 100);
    t.string('acil_telefon', 20);
    t.string('acil_yakinlik', 16);
    t.string('avatar_path', 512);
    t.boolean('profile_complete').notNullable().defaultTo(false);
    t.boolean('is_guest').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('deleted_at').nullable();
    t.timestamps(true, true);
    t.index(['phone']);
    t.index(['tc_kimlik']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('users');
};
