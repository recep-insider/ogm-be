'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('applications', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('status', ['pending', 'approved', 'rejected', 'requires_revision'], {
      useNative: false,
      enumName: null,
    }).notNullable().defaultTo('pending');
    t.string('saglik_raporu_path', 512);
    t.string('sabika_kaydi_path', 512);
    t.json('snapshot');
    t.timestamp('submitted_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('reviewed_at').nullable();
    t.string('reviewed_by', 36).nullable();
    t.text('reviewer_note').nullable();
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['status']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('applications');
};
