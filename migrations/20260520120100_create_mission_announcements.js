'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('mission_announcements', (t) => {
    t.string('id', 36).primary();
    t.string('mission_id', 36).notNullable().references('id').inTable('missions').onDelete('CASCADE');
    t.string('message', 500).notNullable();
    t.enu('severity', ['info', 'alert'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('info');
    t.timestamp('published_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.index(['mission_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mission_announcements');
};
