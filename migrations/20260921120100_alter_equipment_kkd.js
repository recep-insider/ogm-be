'use strict';

// backend-gereksinimleri.md §6: KKD standart beş kalemdir (kask, tulum, bot, eldiven, maske).
// Ömür sonu tarihi kalem tipinden hesaplanır, operatör yalnızca seri numarası girer.
// Beden zimmet kaydına YAZILMAZ — her zaman gönüllü profilinden anlık türetilir.
exports.up = async function up(knex) {
  await knex.schema.alterTable('equipment', (t) => {
    t.string('item_key', 16).nullable(); // kask | tulum | bot | eldiven | maske
    t.string('serial_no', 64).nullable();
    // İade akışı panelden geçici olarak kaldırıldı; alan API tarafında hazır tutulur.
    t.timestamp('returned_at').nullable();
    t.index(['user_id', 'item_key']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('equipment', (t) => {
    t.dropIndex(['user_id', 'item_key']);
    t.dropColumn('item_key');
    t.dropColumn('serial_no');
    t.dropColumn('returned_at');
  });
};
