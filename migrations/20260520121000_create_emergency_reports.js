'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('emergency_reports', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('mission_id', 36).nullable().references('id').inTable('missions').onDelete('SET NULL');
    t.decimal('lat', 10, 7).nullable();
    t.decimal('lng', 10, 7).nullable();
    t.string('message', 500).nullable();
    t.string('dispatched_to', 200).nullable();
    t.string('ip', 64).nullable();
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('emergency_reports');
};
