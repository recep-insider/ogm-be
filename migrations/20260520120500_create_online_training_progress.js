'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('online_training_progress', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('training_id', 36).notNullable().references('id').inTable('online_trainings').onDelete('CASCADE');
    t.enu('status', ['not_started', 'in_progress', 'completed'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('not_started');
    t.integer('progress_percent').notNullable().defaultTo(0);
    t.timestamp('completed_at').nullable();
    t.timestamps(true, true);
    t.unique(['user_id', 'training_id']);
    t.index(['user_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('online_training_progress');
};
