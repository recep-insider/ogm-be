'use strict';

// mobil-gereksinimleri.md §16 + backend §4:
//  - "Acil Bildirimler" EKSİK ZORUNLU alandı: dört kategori vardır ve `acil` sınıfı
//    KAPATILAMAZ (closable:false). Kapatılabilir bir kolon olarak tutulmaz — kolon
//    eklemek onu kapatılabilir kılma riskini doğurur; sunucu her zaman açık döner.
//  - Yarıçap tek başına anlamsızdı: hangi noktadan ölçüldüğü belirsizdi. Gönüllü artık
//    baz konumunu seçer (ikamet il/ilçesi ya da haritada bir nokta), yarıçap o noktadan
//    hesaplanır.
exports.up = async function up(knex) {
  await knex.schema.alterTable('notification_preferences', (t) => {
    t.decimal('base_lat', 10, 7).nullable();
    t.decimal('base_lng', 10, 7).nullable();
    t.string('base_il', 60).nullable();
    t.string('base_ilce', 60).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('notification_preferences', (t) => {
    t.dropColumn('base_lat');
    t.dropColumn('base_lng');
    t.dropColumn('base_il');
    t.dropColumn('base_ilce');
  });
};
