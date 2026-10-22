'use strict';

// KVKK — silinen hesabın kişisel verileri 30 gün sonra anonimleştirilir
// (src/modules/users/anonymize.service.js). İş bu alanla bir kez çalışır.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('anonymized_at').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('anonymized_at');
  });
};
