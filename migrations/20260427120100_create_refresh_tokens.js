'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable();
    t.string('user_agent', 256);
    t.string('ip', 64);
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.string('replaced_by', 36).nullable();
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['token_hash']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('refresh_tokens');
};
