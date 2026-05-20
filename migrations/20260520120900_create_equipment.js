'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('equipment', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('type', 120).notNullable();
    t.date('assigned_at').notNullable();
    t.date('expires_at').nullable();
    // status runtime'da expires_at'e göre türetilir; depolanan değer override için tutulur.
    t.enu('status', ['active', 'expiring_soon', 'expired'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('active');
    t.string('icon_name', 32).nullable();
    t.timestamps(true, true);
    t.index(['user_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('equipment');
};
