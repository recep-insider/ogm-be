'use strict';

// Blog kategorisi (haber | teknik | egitim) 20260921120900 ile geldi ve tüm eski satırlar
// varsayılan `haber` ile kaldı. Kategori, yazının temalarından (themes JSON) türetilir:
// temalar sırayla taranır, ilk eşleşen kategori kazanır; hiçbiri eşleşmezse `haber`
// kalır. Eşleşme büyük/küçük harf ve Türkçe diakritikten bağımsızdır
// ('Eğitim', 'EGITIM', 'Teknik Bilgiler', 'Yangın Haberleri').
//
// Yalnızca hâlâ `haber` olan satırlara dokunulur — panelden teknik/egitim seçilmiş kayıt
// ezilmez.

const TR_FOLD = {
  İ: 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g',
  Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c', Â: 'a', â: 'a', Î: 'i', î: 'i', Û: 'u', û: 'u',
};

function fold(value) {
  return String(value)
    .replace(/[İIıŞşĞğÜüÖöÇçÂâÎîÛû]/g, (ch) => TR_FOLD[ch])
    .toLowerCase();
}

const RULES = [
  { category: 'egitim', pattern: /egitim|ogretici|kurs|tatbikat/ },
  { category: 'teknik', pattern: /teknik|ekipman|donanim|kkd/ },
  { category: 'haber', pattern: /haber|duyuru|gundem/ },
];

function parseThemes(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Temalardan kategori — ilk eşleşen tema belirler; eşleşme yoksa null. */
function categoryFromThemes(themes) {
  for (const theme of parseThemes(themes)) {
    if (typeof theme !== 'string') continue;
    const folded = fold(theme);
    const rule = RULES.find((r) => r.pattern.test(folded));
    if (rule) return rule.category;
  }
  return null;
}

// Geri almanın yalnızca bu adımın değiştirdiği satırlara dokunabilmesi için değişen
// her satır (id + yazılan kategori) bu tabloya kaydedilir. Tablo `down` ile silinir.
//
// MySQL'de DDL örtük commit yapar, yani `up` yarıda kalırsa log tablosu ve bir kısım
// güncelleme kalıcıdır. Bu yüzden `up` yeniden çalıştırılabilir: tablo varsa yeniden
// yaratılmaz, log satırı güncellemeden ÖNCE ve çakışmada yok sayılarak yazılır. Böylece
// yarıda kalan bir koşunun güncellenmiş her satırı zaten log'dadır; tekrar koşu hâlâ
// `haber` olanları tamamlar.
const BACKFILL_LOG = 'blog_category_backfill_log';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(BACKFILL_LOG))) {
    await knex.schema.createTable(BACKFILL_LOG, (t) => {
      t.string('post_id', 36).primary();
      t.string('category', 16).notNullable();
    });
  }

  const rows = await knex('blog_posts').where({ category: 'haber' }).select('id', 'themes');
  for (const row of rows) {
    const category = categoryFromThemes(row.themes);
    if (category && category !== 'haber') {
      // eslint-disable-next-line no-await-in-loop
      await knex(BACKFILL_LOG).insert({ post_id: row.id, category }).onConflict('post_id').ignore();
      // eslint-disable-next-line no-await-in-loop
      await knex('blog_posts').where({ id: row.id }).update({ category });
    }
  }
};

// Geri alma: yalnızca `up`'ın değiştirdiği ve hâlâ o kategoride duran satırlar `haber`'e
// döner. Backfill'den sonra panelden elle kategori seçilmiş (veya zaten teknik/egitim
// olan) kayıtlar ezilmez.
exports.down = async function down(knex) {
  // Kayıt tablosu yoksa hangi satırın backfill'den geldiği bilinemez — hiçbir şey ezilmez.
  if (!(await knex.schema.hasTable(BACKFILL_LOG))) return;
  const changed = await knex(BACKFILL_LOG).select('post_id', 'category');
  for (const row of changed) {
    // eslint-disable-next-line no-await-in-loop
    await knex('blog_posts').where({ id: row.post_id, category: row.category }).update({ category: 'haber' });
  }
  await knex.schema.dropTableIfExists(BACKFILL_LOG);
};

exports.categoryFromThemes = categoryFromThemes;
