'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('fire_reports', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
    t.boolean('anonymous').notNullable().defaultTo(false);
    t.decimal('latitude', 10, 7).notNullable();
    t.decimal('longitude', 10, 7).notNullable();
    t.float('accuracy_m').nullable();
    t.string('description', 500).nullable();
    t.json('photo_paths');
    t.enu('status', ['received', 'dispatched', 'closed'], {
      useNative: false,
      enumName: null,
    }).notNullable().defaultTo('received');
    t.string('ip', 64);
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['status']);
    t.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fire_reports');
};
