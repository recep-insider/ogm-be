'use strict';

// backend-gereksinimleri.md §5: İhbar kaydı posta kodu ve il/ilçe taşımalı — panel
// başlığı artık adresten değil `[Posta Kodu] İl, İlçe` biçiminden türüyor ve bölge
// kapsamı (§11) il alanından eşleşiyor.
// §12: "Sahadaki ihtiyaçlar" panelden kaldırıldı — merkez operatörünün doğrulayamayacağı
// saha verisi; API de döndürmemeli, mobil de göndermemeli.
exports.up = async function up(knex) {
  await knex.schema.alterTable('fire_reports', (t) => {
    t.string('postal_code', 10).nullable();
    t.string('il', 60).nullable();
    t.string('ilce', 60).nullable();
    t.index(['il']);
    t.index(['postal_code', 'created_at']);
  });
  await knex.schema.alterTable('fire_reports', (t) => {
    t.dropColumn('needs');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('fire_reports', (t) => {
    t.json('needs').nullable();
  });
  await knex.schema.alterTable('fire_reports', (t) => {
    t.dropIndex(['il']);
    t.dropIndex(['postal_code', 'created_at']);
    t.dropColumn('postal_code');
    t.dropColumn('il');
    t.dropColumn('ilce');
  });
};
