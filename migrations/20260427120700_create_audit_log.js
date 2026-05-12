'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('audit_log', (t) => {
    t.bigIncrements('id').primary();
    t.string('user_id', 36).nullable();
    t.string('action', 64).notNullable();
    t.string('entity', 64).nullable();
    t.string('entity_id', 64).nullable();
    t.string('ip', 64);
    t.string('user_agent', 256);
    t.json('payload');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
    t.index(['action']);
    t.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('audit_log');
};
