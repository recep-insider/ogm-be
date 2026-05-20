'use strict';

// (user_id, mission_id) → userStatus. Satır yoksa 'not_joined' (BACKEND_API_CONTRACT.md B.9).
// Mission history (8.x) de bu tablodan türetilir.
exports.up = async function up(knex) {
  await knex.schema.createTable('mission_participants', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('mission_id', 36).notNullable().references('id').inTable('missions').onDelete('CASCADE');
    t.enu('status', ['accepted', 'on_site'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('accepted');
    t.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('on_site_at').nullable();
    t.timestamps(true, true);
    t.unique(['user_id', 'mission_id']);
    t.index(['user_id']);
    t.index(['mission_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mission_participants');
};
