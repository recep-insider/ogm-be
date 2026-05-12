'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('devices', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('fcm_token', 256).notNullable();
    t.enu('platform', ['ios', 'android', 'web'], {
      useNative: false,
      enumName: null,
    }).notNullable();
    t.string('app_version', 32);
    t.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.unique(['fcm_token']);
    t.index(['user_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('devices');
};
