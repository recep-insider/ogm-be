'use strict';

// K5: bildirimin okunma sayısı — bildirime dokunup uygulamayı açan tekil gönüllü.
exports.up = async function up(knex) {
  await knex.schema.createTable('notification_opens', (t) => {
    t.string('notification_id', 36).notNullable().references('id').inTable('notification_log').onDelete('CASCADE');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('opened_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['notification_id', 'user_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('notification_opens');
};
