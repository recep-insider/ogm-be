'use strict';

// backend-gereksinimleri.md §10 — SOS sözleşmesi:
//   status: active → responded | cancelled (ÜÇ değer; aradaki adımlar ayrı durum değil,
//   history[] satırlarıdır). `cancelled` YALNIZCA gönüllünün mobilden yaptığı iptaldir.
//   Yanıt süresi türetilir: çağrı saati ile geçmişteki İLK operatör kaydı arası fark.
exports.up = async function up(knex) {
  await knex.schema.alterTable('sos_reports', (t) => {
    t.enu('status', ['active', 'responded', 'cancelled'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('active');
    t.timestamp('responded_at').nullable();
    t.timestamp('cancelled_at').nullable();
    t.index(['status']);
  });

  await knex.schema.createTable('sos_history', (t) => {
    t.string('id', 36).primary();
    t.string('sos_id', 36).notNullable().references('id').inTable('sos_reports').onDelete('CASCADE');
    t.timestamp('time').notNullable().defaultTo(knex.fn.now());
    t.string('event', 300).notNullable();
    // Kaydı kimin/neyin ürettiği: 'Mobil' | 'Sistem' | operatör adı. Yanıt süresi bu ayrımdan türer.
    t.string('by', 120).notNullable().defaultTo('Sistem');
    t.enu('by_kind', ['mobil', 'sistem', 'operator'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('sistem');
    t.timestamps(true, true);
    t.index(['sos_id', 'time']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('sos_history');
  await knex.schema.alterTable('sos_reports', (t) => {
    t.dropIndex(['status']);
    t.dropColumn('status');
    t.dropColumn('responded_at');
    t.dropColumn('cancelled_at');
  });
};
