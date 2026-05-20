'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('mission_photos', (t) => {
    t.string('id', 36).primary();
    t.string('mission_id', 36).notNullable().references('id').inTable('missions').onDelete('CASCADE');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('file_path', 512).notNullable();
    t.enu('kind', ['image', 'video'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('image');
    t.enu('status', ['pending', 'approved', 'rejected'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('pending');
    t.timestamp('submitted_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('reviewed_at').nullable();
    t.string('reviewed_by', 36).nullable();
    t.timestamps(true, true);
    t.index(['mission_id']);
    t.index(['user_id']);
    t.index(['status']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mission_photos');
};
