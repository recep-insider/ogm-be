'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('consents', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('document', ['kvkk', 'aydinlatma', 'acik_riza'], {
      useNative: false,
      enumName: null,
    }).notNullable();
    t.string('version', 32).notNullable();
    t.boolean('granted').notNullable().defaultTo(true);
    t.string('ip', 64);
    t.string('user_agent', 256);
    t.timestamps(true, true);
    t.index(['user_id', 'document']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('consents');
};
