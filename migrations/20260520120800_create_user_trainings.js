'use strict';

// "Aldığım Eğitimler" (BACKEND_API_CONTRACT.md 6.x) — kullanıcının tamamladığı/sürdürdüğü eğitim kayıtları.
exports.up = async function up(knex) {
  await knex.schema.createTable('user_trainings', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 200).notNullable();
    t.text('description').nullable();
    t.integer('duration_min').notNullable().defaultTo(0);
    t.date('completed_at').nullable();
    t.string('instructor_name', 120).nullable();
    t.integer('progress_percent').notNullable().defaultTo(0);
    t.enu('status', ['completed', 'in_progress'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('in_progress');
    t.string('certificate_path', 512).nullable();
    t.timestamps(true, true);
    t.index(['user_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_trainings');
};
