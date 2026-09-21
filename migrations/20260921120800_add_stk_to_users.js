'use strict';

// mobil-gereksinimleri.md §11 + backend §14: STK üyeliği kapandı — kaynak OGM'nin kendi
// kaydıdır, gönüllü BAŞVURU SIRASINDA beyan eder. AFAD ya da başka bir kurumun
// listesiyle entegrasyon yapılmayacak. Alan serbest metin kalır (enum'a bağlanmaz);
// göreve çağrı, QR okutma künyesi ve raporlarda görünür.
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('stk_text', 200).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('stk_text');
  });
};
