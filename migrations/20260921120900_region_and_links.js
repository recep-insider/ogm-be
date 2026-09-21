'use strict';

// backend-gereksinimleri.md §11 — kapsam (bölge) modeli il alanından eşleşir, bu yüzden
// olay kaydı da il/ilçe taşımalı (ihbar §5 ile zaten taşıyor).
// §5 — birden fazla ihbar TEK olay kaydına bağlanabilir ve bağlantı sonradan
// kaldırılabilmelidir; bağın tek sahibi ihbar kaydıdır (fire_reports.mission_id).
// mobil §11 — "İkamet Adresi" serbest metni yerini İl/İlçe'ye bırakıyor; panelin bölge
// kapsamı serbest metinle eşleşemiyordu.
// mobil §9 — blog kategorileri panelle birebir: Haber · Teknik · Eğitim ("duyuru"
// kaldırıldı; duyurular Bildirim Merkezi'nden gider).
exports.up = async function up(knex) {
  await knex.schema.alterTable('missions', (t) => {
    t.string('il', 60).nullable();
    t.string('ilce', 60).nullable();
    t.index(['il']);
  });

  await knex.schema.alterTable('fire_reports', (t) => {
    t.string('mission_id', 36).nullable().references('id').inTable('missions').onDelete('SET NULL');
    t.index(['mission_id']);
  });

  await knex.schema.alterTable('users', (t) => {
    t.string('il', 60).nullable();
    t.string('ilce', 60).nullable();
  });

  await knex.schema.alterTable('blog_posts', (t) => {
    t.enu('category', ['haber', 'teknik', 'egitim'], { useNative: false, enumName: null })
      .notNullable()
      .defaultTo('haber');
    t.index(['category']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('blog_posts', (t) => {
    t.dropIndex(['category']);
    t.dropColumn('category');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('il');
    t.dropColumn('ilce');
  });
  await knex.schema.alterTable('fire_reports', (t) => {
    t.dropIndex(['mission_id']);
    t.dropColumn('mission_id');
  });
  await knex.schema.alterTable('missions', (t) => {
    t.dropIndex(['il']);
    t.dropColumn('il');
    t.dropColumn('ilce');
  });
};
