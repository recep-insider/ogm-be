'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('uat_events', (t) => {
    t.bigIncrements('id').primary();
    t.string('panel_user_id', 36).nullable().references('id').inTable('panel_users').onDelete('SET NULL');
    t.string('session_id', 36).notNullable();
    t.integer('seq').unsigned().notNullable();
    t.bigInteger('client_ts').notNullable();
    t.string('type', 16).notNullable();
    t.string('page', 120).nullable();
    t.string('context', 120).nullable();
    t.string('target', 255).nullable();
    t.json('detail').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['session_id', 'seq']);
    t.index(['panel_user_id']);
    t.index(['type']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('uat_events');
};
