'use strict';

// backend-gereksinimleri.md §1 — türetilen alanlar. İstemci hesaplamaz, sunucu döner.
// Buradaki fonksiyonlar SAF'tır: veriyi çağıran toplar (bkz. volunteers/readiness.service.js),
// böylece aynı türetim hem mobil profil hem panel künyesi için tek kaynaktan çalışır.
// Kapsam (bölge) türetimin İÇİNDE değildir — süzülmüş havuzu çağıran verir.

const { kkdDurumu } = require('./kkd');

/** Hazırlık zincirinin adımları — sıra atlanamaz, adımlar birbirinin yerine geçmez (§7). */
const CHAIN_STEPS = ['komisyon', 'teorik', 'uygulamali', 'kkd'];

const STEP_LABEL = {
  komisyon: 'Komisyon onayı',
  teorik: 'Teorik eğitim',
  uygulamali: 'Uygulamalı (saha) eğitimi',
  kkd: 'KKD teslimi',
};

/**
 * Komisyon kararı — kaydı olmayan başvuru 'pending'dir ("henüz görüşülmedi").
 * @param {{decision?:string}|null|undefined} decisionRow En güncel komisyon kararı satırı
 * @returns {'approved'|'rejected'|'pending'}
 */
function komisyonKarari(decisionRow) {
  if (!decisionRow) return 'pending';
  return decisionRow.decision === 'approved' ? 'approved' : 'rejected';
}

/**
 * Teorik eğitim tamam mı — yayındaki ZORUNLU teorik eğitimlerin tamamı tamamlanmalı.
 * Zorunlu eğitim tanımlı değilse kapı yoktur (adım tamam sayılır).
 * @param {string[]} requiredTrainingIds Yayında + zorunlu eğitim id'leri
 * @param {string[]} completedTrainingIds Kullanıcının tamamladığı eğitim id'leri
 */
function teorikTamam(requiredTrainingIds, completedTrainingIds) {
  const completed = new Set(completedTrainingIds || []);
  return (requiredTrainingIds || []).every((id) => completed.has(id));
}

/**
 * Uygulamalı eğitim tamam mı — yetkinlik bayraklı bir saha eğitiminin yoklamasında
 * "katıldı" işaretliyse tamam. Etkinlik türü (bayraksız) kayıtlar bu kapıdan geçmez.
 * @param {Array<{attendance?:string, grants_competency?:any}>} attendanceRows
 */
function uygulamaliTamam(attendanceRows) {
  return (attendanceRows || []).some((r) => r.attendance === 'katildi' && !!r.grants_competency);
}

/**
 * Hazırlık zinciri — her adımın tamam/eksik durumu ve gönüllünün nerede takıldığı.
 * @param {{decision?:object|null, requiredTrainingIds?:string[], completedTrainingIds?:string[],
 *          attendanceRows?:object[], equipmentRows?:object[]}} input
 */
function hazirlikZinciri(input, now = new Date()) {
  const karar = komisyonKarari(input.decision);
  const kkd = kkdDurumu(input.equipmentRows, now);

  const steps = {
    komisyon: { done: karar === 'approved', state: karar },
    teorik: { done: teorikTamam(input.requiredTrainingIds, input.completedTrainingIds) },
    uygulamali: { done: uygulamaliTamam(input.attendanceRows) },
    kkd: { done: kkd === 'tam', state: kkd },
  };

  const eksikler = CHAIN_STEPS.filter((k) => !steps[k].done);
  return {
    steps: CHAIN_STEPS.map((key) => ({
      key,
      label: STEP_LABEL[key],
      done: steps[key].done,
      state: steps[key].state,
    })),
    komisyon: karar,
    kkdDurumu: kkd,
    eksikAdimlar: eksikler,
    // Gönüllünün takıldığı ilk adım — mobil "nerede kaldın" göstergesi bunu okur.
    siradakiAdim: eksikler.length ? eksikler[0] : null,
    tamam: eksikler.length === 0,
  };
}

/**
 * Müdahale yetkisi ayrı bir alan değildir: komisyon onayı + teorik + uygulamalı + KKD `tam`.
 * @param {ReturnType<typeof hazirlikZinciri>} zincir
 */
function mudahaleYetkisi(zincir) {
  return zincir.tamam;
}

/**
 * Kişi durumu — `pasif` operatör/gönüllü kararıdır (is_active=false), diğer ikisi türetilir.
 * @param {ReturnType<typeof hazirlikZinciri>} zincir
 * @param {{isActive?:boolean}} flags
 * @returns {'basvuru'|'hazir'|'pasif'}
 */
function kisiDurumu(zincir, { isActive = true } = {}) {
  if (!isActive) return 'pasif';
  return mudahaleYetkisi(zincir) ? 'hazir' : 'basvuru';
}

/**
 * Katılım engelleri — eksiği olan gönüllü hiçbir göreve katılamaz, istisna yok (§5).
 * Check-in anında YENİDEN değerlendirilir: KKD ömrü dolmuş veya zimmet iade alınmış olabilir.
 * @returns {Array<{key:string, label:string}>} boş dizi = engel yok
 */
function katilimEngelleri(zincir) {
  return zincir.eksikAdimlar.map((key) => ({ key, label: STEP_LABEL[key] }));
}

module.exports = {
  CHAIN_STEPS,
  STEP_LABEL,
  komisyonKarari,
  teorikTamam,
  uygulamaliTamam,
  hazirlikZinciri,
  mudahaleYetkisi,
  kisiDurumu,
  katilimEngelleri,
};
