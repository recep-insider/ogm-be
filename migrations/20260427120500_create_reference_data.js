'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('reference_data', (t) => {
    t.increments('id').primary();
    t.string('category', 32).notNullable();
    t.string('value', 100).notNullable();
    t.string('label', 200).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.unique(['category', 'value']);
    t.index(['category', 'is_active', 'sort_order']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('reference_data');
};
