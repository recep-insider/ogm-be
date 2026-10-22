'use strict';

// Olay zaman çizelgesi ve KVKK anonimleştirmesi audit_log'u entity_id ile okur/günceller;
// indeks yoksa her istek tabloyu baştan sona tarar.
exports.up = async function up(knex) {
  await knex.schema.alterTable('audit_log', (t) => {
    t.index(['entity_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('audit_log', (t) => {
    t.dropIndex(['entity_id']);
  });
};
