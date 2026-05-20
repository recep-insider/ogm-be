'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('saha_trainings', (t) => {
    t.string('id', 36).primary();
    t.string('title', 200).notNullable();
    t.string('location', 200).notNullable();
    t.date('start_date').notNullable();
    t.string('start_time', 5).notNullable(); // HH:mm
    t.string('end_time', 5).notNullable();
    t.string('instructor_name', 120).notNullable();
    t.string('instructor_avatar_path', 512).nullable();
    t.string('cover_path', 512).nullable();
    t.integer('total_seats').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['is_active', 'start_date']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('saha_trainings');
};
