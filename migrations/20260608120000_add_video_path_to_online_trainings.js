'use strict';

exports.up = async function up(knex) {
  await knex.schema.alterTable('online_trainings', (t) => {
    t.string('video_path', 500).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('online_trainings', (t) => {
    t.dropColumn('video_path');
  });
};
