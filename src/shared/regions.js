'use strict';

// backend-gereksinimleri.md §11 / prd.md §4 — kapsam (bölge) modeli.
//
// Faz 1 tek kırılımla çalışır: Türkiye'nin YEDİ COĞRAFİ BÖLGESİ. 81 ilin tamamı tam
// olarak bir bölgeye aittir ve eşleşme İL alanından yapılır. OGM teşkilat kırılımı
// (Bölge Müdürlüğü → İşletme Müdürlüğü → İşletme Şefliği) faz 2'dir ve bundan
// BAĞIMSIZ kurulacak — teşkilat sınırları mülki sınırlarla örtüşmüyor.
//
// Kapsam yalnızca OLAY ve İHBAR kayıtlarını süzer. Gönüllüler bölge kapsamına
// GİRMEZ: "şu bölgenin gönüllüsü" diye bir kavram yoktur; gönüllü listesi, sayaçlar
// ve bildirim hedef kitlesi her zaman tüm gönüllüleri kapsar.

const REGIONS = [
  {
    key: 'akdeniz',
    label: 'Akdeniz',
    default: true,
    cities: ['Adana', 'Antalya', 'Burdur', 'Hatay', 'Isparta', 'Kahramanmaraş', 'Mersin', 'Osmaniye'],
  },
  {
    key: 'ege',
    label: 'Ege',
    cities: ['Afyonkarahisar', 'Aydın', 'Denizli', 'İzmir', 'Kütahya', 'Manisa', 'Muğla', 'Uşak'],
  },
  {
    key: 'marmara',
    label: 'Marmara',
    cities: [
      'Balıkesir', 'Bilecik', 'Bursa', 'Çanakkale', 'Edirne', 'İstanbul',
      'Kırklareli', 'Kocaeli', 'Sakarya', 'Tekirdağ', 'Yalova',
    ],
  },
  {
    key: 'karadeniz',
    label: 'Karadeniz',
    cities: [
      'Amasya', 'Artvin', 'Bartın', 'Bayburt', 'Bolu', 'Çorum', 'Düzce', 'Giresun',
      'Gümüşhane', 'Karabük', 'Kastamonu', 'Ordu', 'Rize', 'Samsun', 'Sinop',
      'Tokat', 'Trabzon', 'Zonguldak',
    ],
  },
  {
    key: 'ic-anadolu',
    label: 'İç Anadolu',
    cities: [
      'Aksaray', 'Ankara', 'Çankırı', 'Eskişehir', 'Karaman', 'Kayseri', 'Kırıkkale',
      'Kırşehir', 'Konya', 'Nevşehir', 'Niğde', 'Sivas', 'Yozgat',
    ],
  },
  {
    key: 'dogu-anadolu',
    label: 'Doğu Anadolu',
    cities: [
      'Ağrı', 'Ardahan', 'Bingöl', 'Bitlis', 'Elazığ', 'Erzincan', 'Erzurum', 'Hakkâri',
      'Iğdır', 'Kars', 'Malatya', 'Muş', 'Tunceli', 'Van',
    ],
  },
  {
    key: 'guneydogu-anadolu',
    label: 'Güneydoğu Anadolu',
    cities: [
      'Adıyaman', 'Batman', 'Diyarbakır', 'Gaziantep', 'Kilis', 'Mardin', 'Siirt',
      'Şanlıurfa', 'Şırnak',
    ],
  },
];

const DEFAULT_REGION = REGIONS.find((r) => r.default).key;
const REGION_KEYS = REGIONS.map((r) => r.key);

// İl adı üç ayrı yerden gelebiliyor (mobil dropdown, Nominatim, panel) ve büyük/küçük
// harf, Türkçe diakritik ve noktalı-İ farkları eşleşmeyi bozuyor. toLocaleLowerCase('tr-TR')
// Node'un ICU derlemesine bağlı olduğundan (küçük ICU'da 'İSTANBUL' ≠ 'İstanbul'),
// eşleşme deterministik bir harf tablosuyla ASCII'ye indirgenerek yapılır.
const TR_FOLD = {
  İ: 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g',
  Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c', Â: 'a', â: 'a',
};

/** Eşleşme anahtarı — Türkçe diakritikler ASCII'ye indirgenir, boşluklar sadeleşir. */
function normalizeCity(city) {
  if (!city) return '';
  return String(city)
    .trim()
    .replace(/[İIıŞşĞğÜüÖöÇçÂâ]/g, (ch) => TR_FOLD[ch])
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const CITY_TO_REGION = new Map();
for (const region of REGIONS) {
  for (const city of region.cities) CITY_TO_REGION.set(normalizeCity(city), region.key);
}

const CANONICAL_CITY = new Map();
for (const region of REGIONS) {
  for (const city of region.cities) CANONICAL_CITY.set(normalizeCity(city), city);
}

/**
 * Serbest yazılmış il adını 81 ilin kanonik yazımına çevirir ('istanbul', 'HAKKARI' →
 * 'İstanbul', 'Hakkâri'). Tanınmayan il için null — çağıran reddeder.
 */
function canonicalCity(city) {
  return CANONICAL_CITY.get(normalizeCity(city)) || null;
}

/**
 * Joi `.custom()` doğrulayıcısı — il alanını kanonik ada normalize eder, 81 il dışını
 * `any.invalid` ile reddeder. Boş değerler (null/'') şemanın `allow` kuralına bırakılır.
 */
function cityJoiValidator(value, helpers) {
  if (value == null || value === '') return value;
  const canonical = canonicalCity(value);
  return canonical || helpers.error('any.invalid');
}

/** İl adından bölge anahtarı; tanınmayan/boş il için null (kayıt elenmez, gruplanamaz). */
function regionForCity(city) {
  return CITY_TO_REGION.get(normalizeCity(city)) || null;
}

/** Bölgenin kapsadığı il listesi — SQL `whereIn('il', ...)` için. */
function citiesOfRegion(regionKey) {
  const region = REGIONS.find((r) => r.key === regionKey);
  return region ? region.cities : null;
}

function isRegionKey(value) {
  return REGION_KEYS.includes(value);
}

/** Bölge etiketi (panel başlıklarında gruplama için). */
function regionLabel(regionKey) {
  return REGIONS.find((r) => r.key === regionKey)?.label || null;
}

/**
 * Bir knex sorgusuna bölge süzmesi uygular. `region` verilmemişse ya da "Tüm
 * Bölgeler" (`all`) ise HİÇBİR kayıt elenmez — genel müdürlük seviyesi görünümü.
 * Süzme yalnızca GÖRÜNÜMÜ etkiler; oluşturmayı engellemez (§11).
 *
 * @param {import('knex').Knex.QueryBuilder} query
 * @param {string|undefined} region
 * @param {string} column  İl kolonunun tam adı (ör. 'fr.il')
 */
function applyRegionFilter(query, region, column) {
  if (!region || region === 'all') return query;
  const cities = citiesOfRegion(region);
  if (!cities) return query;
  return query.whereIn(column, cities);
}

module.exports = {
  REGIONS,
  REGION_KEYS,
  DEFAULT_REGION,
  regionForCity,
  citiesOfRegion,
  regionLabel,
  isRegionKey,
  applyRegionFilter,
  normalizeCity,
  canonicalCity,
  cityJoiValidator,
};
