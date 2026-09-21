'use strict';

// backend-gereksinimleri.md §4 — operatörün ELLE gönderdiği bildirimlerin denetim izi.
// Kanal kategoriden türer (SMS yalnızca `acil`), yarıçap admin'de girilmez; burada
// yalnızca ne gönderildiği ve kime ulaştığı saklanır.
exports.up = async function up(knex) {
  await knex.schema.createTable('notification_log', (t) => {
    t.string('id', 36).primary();
    t.enu('category', ['acil', 'gorev', 'egitim', 'bilgi'], { useNative: false, enumName: null })
      .notNullable();
    t.string('title', 200).notNullable();
    t.string('body', 500).notNullable();
    // Olay bazlı gönderimde hedef olay; genel gönderimde null.
    t.string('mission_id', 36).nullable().references('id').inTable('missions').onDelete('SET NULL');
    t.json('target').notNullable();
    t.integer('push_count').notNullable().defaultTo(0);
    t.integer('sms_count').notNullable().defaultTo(0);
    t.string('sent_by', 120).nullable();
    t.timestamp('sent_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.index(['sent_at']);
    t.index(['mission_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('notification_log');
};
