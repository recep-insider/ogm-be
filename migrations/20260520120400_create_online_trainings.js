'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('online_trainings', (t) => {
    t.string('id', 36).primary();
    t.string('title', 200).notNullable();
    t.text('description').nullable();
    t.integer('duration_min').notNullable().defaultTo(0);
    t.enu('icon_tone', ['primary', 'tertiary'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('primary');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['is_active', 'sort_order']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('online_trainings');
};
