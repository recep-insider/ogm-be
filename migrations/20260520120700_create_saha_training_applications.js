'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('saha_training_applications', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('training_id', 36).notNullable().references('id').inTable('saha_trainings').onDelete('CASCADE');
    t.enu('status', ['pending', 'approved', 'rejected'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('pending');
    t.timestamps(true, true);
    t.unique(['user_id', 'training_id']);
    t.index(['training_id']);
    t.index(['user_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('saha_training_applications');
};
