'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('notification_preferences', (t) => {
    t.string('user_id', 36).primary().references('id').inTable('users').onDelete('CASCADE');
    t.boolean('task_calls').notNullable().defaultTo(true);
    t.boolean('trainings').notNullable().defaultTo(true);
    t.boolean('announcements').notNullable().defaultTo(true);
    t.integer('distance_km').notNullable().defaultTo(50);
    t.integer('distance_min').notNullable().defaultTo(5);
    t.integer('distance_max').notNullable().defaultTo(200);
    t.timestamps(true, true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('notification_preferences');
};
