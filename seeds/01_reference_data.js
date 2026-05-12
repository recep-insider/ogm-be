'use strict';

const KAN_GRUBU = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', '0+', '0-'];
const OGRENIM = ['Lise', 'Ön Lisans', 'Lisans', 'Yüksek Lisans', 'Doktora', 'Diğer'];
const MESLEK = ['Memur', 'Öğretmen', 'Mühendis', 'Öğrenci', 'Emekli', 'Diğer'];
const YAKINLIK = ['Anne', 'Baba', 'Eş', 'Kardeş', 'Arkadaş', 'Diğer'];
const HOBILER = [
  'Doğa yürüyüşü',
  'Kamp',
  'Bisiklet',
  'Fotoğrafçılık',
  'Bahçe',
  'Yüzme',
  'Koşu',
  'Tırmanış',
  'Kitap okuma',
  'Müzik',
];

const ULKELER = [
  { value: '+90', label: 'Türkiye' },
  { value: '+1', label: 'ABD/Kanada' },
  { value: '+44', label: 'Birleşik Krallık' },
  { value: '+49', label: 'Almanya' },
  { value: '+33', label: 'Fransa' },
  { value: '+39', label: 'İtalya' },
  { value: '+34', label: 'İspanya' },
  { value: '+31', label: 'Hollanda' },
  { value: '+32', label: 'Belçika' },
  { value: '+41', label: 'İsviçre' },
  { value: '+43', label: 'Avusturya' },
  { value: '+45', label: 'Danimarka' },
  { value: '+46', label: 'İsveç' },
  { value: '+47', label: 'Norveç' },
  { value: '+48', label: 'Polonya' },
  { value: '+30', label: 'Yunanistan' },
  { value: '+359', label: 'Bulgaristan' },
  { value: '+994', label: 'Azerbaycan' },
  { value: '+995', label: 'Gürcistan' },
  { value: '+7', label: 'Rusya' },
  { value: '+971', label: 'BAE' },
  { value: '+966', label: 'Suudi Arabistan' },
  { value: '+961', label: 'Lübnan' },
  { value: '+20', label: 'Mısır' },
  { value: '+212', label: 'Fas' },
];

function pairs(values) {
  return values.map((v) => ({ value: v, label: v }));
}

exports.seed = async function seed(knex) {
  await knex('reference_data').del();

  const rows = [];
  let order = 0;
  const push = (cat, items) => {
    for (const it of items) {
      rows.push({
        category: cat,
        value: it.value,
        label: it.label,
        sort_order: order++,
        is_active: true,
      });
    }
  };

  push('kan-grubu', pairs(KAN_GRUBU));
  push('ogrenim', pairs(OGRENIM));
  push('meslek', pairs(MESLEK));
  push('yakinlik', pairs(YAKINLIK));
  push('hobiler', pairs(HOBILER));
  push('ulkeler', ULKELER);

  await knex('reference_data').insert(rows);
};
