'use strict';

exports.up = async function up(knex) {
  await knex.schema.createTable('blog_posts', (t) => {
    t.string('id', 36).primary();
    t.string('title', 250).notNullable();
    t.text('description').nullable();
    t.string('cover_path', 512).nullable();
    t.date('published_at').notNullable();
    t.integer('read_time_min').notNullable().defaultTo(1);
    t.json('themes').nullable(); // max 2 (BlogTheme[])
    t.string('author_name', 120).nullable();
    t.string('author_role', 120).nullable();
    t.string('author_avatar_path', 512).nullable();
    t.json('content').nullable(); // BlogContentBlock[]
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['is_active', 'published_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('blog_posts');
};
