'use strict';

// backend-gereksinimleri.md §1 + §7: Teorik eğitim durumu "yayında + ZORUNLU teorik
// eğitimlerin tamamı tamamlandıysa" tamamdır — taslak eğitim kapı olamaz. Eğitim yüz yüze
// de verilebilir (`delivery`); mevcut yönetmelikte online tanımı olmadığı için zorunlu
// olanlar yüz yüze işaretlidir. Mevzuat değişirse yalnızca bu alan değişir.
exports.up = async function up(knex) {
  await knex.schema.alterTable('online_trainings', (t) => {
    t.boolean('required').notNullable().defaultTo(false);
    t.enu('delivery', ['yuzyuze', 'online'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('online');
    t.index(['required', 'is_active']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('online_trainings', (t) => {
    t.dropIndex(['required', 'is_active']);
    t.dropColumn('required');
    t.dropColumn('delivery');
  });
};
