'use strict';

// K17: iki görevli aynı yazıyı düzenlerse sonra kaydeden, araya giren değişikliği ezmesin.
exports.up = async function up(knex) {
  await knex.schema.alterTable('blog_posts', (t) => {
    t.integer('version').unsigned().notNullable().defaultTo(1);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('blog_posts', (t) => {
    t.dropColumn('version');
  });
};
