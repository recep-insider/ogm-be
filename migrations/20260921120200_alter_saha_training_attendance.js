'use strict';

// backend-gereksinimleri.md §8: Yoklama, uygulamalı eğitimin tamamlandığını işaretleyen
// TEK mekanizmadır. Yetkinlik bayrağı olmayan kayıtlar (buluşma, tanıtım) katılımı
// yangın müdahale kapısından geçirmez. Katılımcı durumu yalnızca kayitli | katildi —
// yedek/kontenjan-dolu kavramı kaldırıldı.
exports.up = async function up(knex) {
  await knex.schema.alterTable('saha_trainings', (t) => {
    t.boolean('grants_competency').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('saha_training_applications', (t) => {
    t.enu('attendance', ['kayitli', 'katildi'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('kayitli');
    t.timestamp('attendance_at').nullable();
    // §6: yoklamada "KKD teslim" aynı satırdan işaretlenebilir.
    t.boolean('kkd_delivered').notNullable().defaultTo(false);
    t.index(['training_id', 'attendance']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('saha_training_applications', (t) => {
    t.dropIndex(['training_id', 'attendance']);
    t.dropColumn('attendance');
    t.dropColumn('attendance_at');
    t.dropColumn('kkd_delivered');
  });
  await knex.schema.alterTable('saha_trainings', (t) => {
    t.dropColumn('grants_competency');
  });
};
