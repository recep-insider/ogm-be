'use strict';

// backend-gereksinimleri.md §12 — "Saha güncellemeleri akışı" panelden kaldırıldı:
// merkez operatörünün masa başında doğrulayamayacağı saha verisi. Duyurular artık
// Bildirim Merkezi'nden gider (mobil §9), bu yüzden olaya bağlı duyuru akışı da
// API'den kalkar.
//
// mobil §5 — görev adı ve ROL ETİKETİ silindi ("SAHA OPERASYONU" / "LOJİSTİK DESTEK"):
// panelde destek rolü diye bir ayrım yok, görev sahada belirlenir. `missions.category`
// bu etiketi taşıyan tek alandı. Eski kayıtların başlığı da görev adı yerine olayın
// kendi adına (full_title) çekilir.
exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists('mission_announcements');

  // Görev adı olarak kaydedilmiş başlıkları olayın adına çevir ("Su ve Kumanya
  // Dağıtımı" → "Marmaris Orman Yangını").
  await knex.raw('update missions set title = full_title where full_title is not null and full_title <> title');

  await knex.schema.alterTable('missions', (t) => {
    t.dropColumn('category');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('missions', (t) => {
    t.string('category', 64).notNullable().defaultTo('yangin');
  });

  await knex.schema.createTable('mission_announcements', (t) => {
    t.string('id', 36).primary();
    t.string('mission_id', 36).notNullable().references('id').inTable('missions').onDelete('CASCADE');
    t.text('message').notNullable();
    t.enu('severity', ['info', 'alert'], { useNative: false, enumName: null }).notNullable().defaultTo('info');
    t.timestamp('published_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.index(['mission_id']);
  });
};
