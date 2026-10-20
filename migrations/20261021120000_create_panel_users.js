'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('panel_users', (t) => {
    t.string('id', 36).primary();
    t.string('name', 120).notNullable();
    t.string('email', 254).notNullable().unique();
    t.string('unit_id', 100).nullable().references('id').inTable('forest_units').onDelete('SET NULL');
    t.string('phone', 20).nullable();
    t.string('password_hash', 255).notNullable();
    t.enu('role', ['admin', 'super_admin'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('admin');
    t.enu('status', ['pending', 'active', 'rejected', 'disabled'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('pending');
    t.boolean('is_system').notNullable().defaultTo(false);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.timestamp('requested_at').nullable();
    t.string('approved_by', 36).nullable().references('id').inTable('panel_users').onDelete('SET NULL');
    t.timestamp('approved_at').nullable();
    t.string('rejection_reason', 500).nullable();
    t.timestamp('last_login_at').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('panel_refresh_tokens', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('panel_users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.string('replaced_by', 36).nullable();
    t.string('ip', 64).nullable();
    t.string('user_agent', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });

  await knex.schema.createTable('panel_user_audit', (t) => {
    t.bigIncrements('id').primary();
    t.string('actor_id', 36).nullable().references('id').inTable('panel_users').onDelete('SET NULL');
    t.string('target_id', 36).nullable().references('id').inTable('panel_users').onDelete('SET NULL');
    t.string('action', 64).notNullable();
    t.json('detail').nullable();
    t.timestamp('at').notNullable().defaultTo(knex.fn.now());
    t.index(['target_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('panel_user_audit');
  await knex.schema.dropTableIfExists('panel_refresh_tokens');
  await knex.schema.dropTableIfExists('panel_users');
};
