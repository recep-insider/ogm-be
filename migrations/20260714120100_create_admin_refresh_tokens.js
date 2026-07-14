'use strict';

/**
 * Admin/officer refresh token store. Mirrors the volunteer `refresh_tokens`
 * table pattern but references `admin_users` — the two flows stay independent
 * (rotation, revoke, blacklist are handled separately).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('admin_refresh_tokens', (t) => {
    t.string('id', 36).primary(); // jti
    t.string('admin_user_id', 36)
      .notNullable()
      .references('id')
      .inTable('admin_users')
      .onDelete('CASCADE');
    t.string('token_hash', 128).notNullable();
    t.string('user_agent', 256);
    t.string('ip', 64);
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.string('replaced_by', 36).nullable();
    t.timestamps(true, true);
    t.index(['admin_user_id']);
    t.index(['token_hash']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('admin_refresh_tokens');
};
