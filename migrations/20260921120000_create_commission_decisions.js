'use strict';

// backend-gereksinimleri.md §7: Komisyon onayı gönüllü kaydında bayrak olarak DEĞİL,
// ayrı kayıt olarak tutulur — red kararı da saklanır, karar tarih ve karar vereni taşır.
// Kaydı olmayan başvuru 'pending'dir (varsayılan değil, "henüz görüşülmedi" anlamında).
exports.up = async function up(knex) {
  await knex.schema.createTable('commission_decisions', (t) => {
    t.string('id', 36).primary();
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('decision', ['approved', 'rejected'], { useNative: false, enumName: null }).notNullable();
    t.timestamp('decided_at').notNullable().defaultTo(knex.fn.now());
    // Kararı veren Bölge Müdürlüğü Komisyonu görevlisi (panel operatörü değil, karar sahibi).
    t.string('decided_by', 120).nullable();
    t.string('decision_no', 64).nullable();
    t.text('note').nullable();
    // §7.1: karar ile SMS tek işlemdir; gönderim kaydı denetim izi taşır.
    t.timestamp('sms_sent_at').nullable();
    t.string('sms_phone', 20).nullable();
    t.timestamps(true, true);
    t.index(['user_id']);
    t.index(['decided_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('commission_decisions');
};
