'use strict';

// Panel eğitim formunun kilitli alanları: teorik eğitime kapak ve içerik, saha eğitimine
// açıklama ve içerik. İçerik blog_posts.content ile aynı blok biçimindedir.
exports.up = async function up(knex) {
  await knex.schema.alterTable('online_trainings', (t) => {
    t.string('cover_path', 512).nullable();
    t.json('content').nullable();
  });
  await knex.schema.alterTable('saha_trainings', (t) => {
    t.text('description').nullable();
    t.json('content').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('saha_trainings', (t) => {
    t.dropColumn('content');
    t.dropColumn('description');
  });
  await knex.schema.alterTable('online_trainings', (t) => {
    t.dropColumn('content');
    t.dropColumn('cover_path');
  });
};
