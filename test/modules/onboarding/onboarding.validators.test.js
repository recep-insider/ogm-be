'use strict';

// onboardingSchema — yeni egitim bloğu ve opsiyonel hobiler davranışı.
// Controller ile aynı seçenekler kullanılır; kritik nokta: egitim bloğu şemada
// tanımlı olduğundan stripUnknown ile SESSİZCE SİLİNMEZ (frontend'in raporladığı veri kaybı).

const { onboardingSchema } = require('../../../src/modules/onboarding/onboarding.validators');

const VALIDATE_OPTIONS = { abortEarly: false, stripUnknown: true, convert: true };

function basePayload() {
  return {
    kimlik: { tcKimlik: '10000000146', ad: 'Ali', soyad: 'Yılmaz', dogumTarihi: '1990-05-15' },
    iletisim: { eposta: 'ali@example.com', adres: 'Örnek Mah. Test Sok. No:1 Marmaris' },
    kisisel: { kanGrubu: 'A+', ogrenim: 'Lisans', meslek: 'Memur', hobiler: ['Doğa Yürüyüşü'] },
    acil: { ad: 'Ayşe', soyad: 'Yılmaz', telefon: '+905329876543', yakinlik: 'Eş' },
  };
}

function validEgitim() {
  return {
    il: 'Antalya',
    ilce: 'Alanya',
    bolgeMudurlugu: 'Antalya Orman Bölge Müdürlüğü',
    isletmeMudurlugu: 'Alanya Orman İşletme Müdürlüğü',
    giysiBedeni: 'M',
    ayakkabiNumarasi: 38,
    aciklama: null,
  };
}

describe('onboardingSchema — egitim bloğu', () => {
  test('egitim olmadan geçerli (eski frontend uyumluluğu)', () => {
    const { error, value } = onboardingSchema.validate(basePayload(), VALIDATE_OPTIONS);
    expect(error).toBeUndefined();
    expect(value.egitim).toBeUndefined();
  });

  test('geçerli egitim bloğu stripUnknown altında KORUNUR', () => {
    const payload = { ...basePayload(), egitim: validEgitim() };
    const { error, value } = onboardingSchema.validate(payload, VALIDATE_OPTIONS);
    expect(error).toBeUndefined();
    expect(value.egitim).toMatchObject({
      il: 'Antalya',
      ilce: 'Alanya',
      bolgeMudurlugu: 'Antalya Orman Bölge Müdürlüğü',
      isletmeMudurlugu: 'Alanya Orman İşletme Müdürlüğü',
      giysiBedeni: 'M',
      ayakkabiNumarasi: 38,
    });
  });

  test.each([
    ['giysiBedeni enum dışı', { giysiBedeni: 'XS' }],
    ['ayakkabiNumarasi alt sınır altı (33)', { ayakkabiNumarasi: 33 }],
    ['ayakkabiNumarasi üst sınır üstü (51)', { ayakkabiNumarasi: 51 }],
    ['ayakkabiNumarasi tam sayı değil', { ayakkabiNumarasi: 38.5 }],
    ['aciklama 500 karakterden uzun', { aciklama: 'x'.repeat(501) }],
    ['il eksik', { il: undefined }],
    ['isletmeMudurlugu eksik', { isletmeMudurlugu: undefined }],
  ])('geçersiz egitim reddedilir: %s', (_label, patch) => {
    const payload = { ...basePayload(), egitim: { ...validEgitim(), ...patch } };
    const { error } = onboardingSchema.validate(payload, VALIDATE_OPTIONS);
    expect(error).toBeDefined();
  });

  test('aciklama null ve boş string kabul edilir', () => {
    for (const aciklama of [null, '']) {
      const payload = { ...basePayload(), egitim: { ...validEgitim(), aciklama } };
      const { error } = onboardingSchema.validate(payload, VALIDATE_OPTIONS);
      expect(error).toBeUndefined();
    }
  });
});

describe('onboardingSchema — hobiler artık opsiyonel', () => {
  test('hobiler gönderilmezse boş diziye default\'lanır', () => {
    const payload = basePayload();
    delete payload.kisisel.hobiler;
    const { error, value } = onboardingSchema.validate(payload, VALIDATE_OPTIONS);
    expect(error).toBeUndefined();
    expect(value.kisisel.hobiler).toEqual([]);
  });

  test('boş hobiler dizisi kabul edilir', () => {
    const payload = basePayload();
    payload.kisisel.hobiler = [];
    const { error, value } = onboardingSchema.validate(payload, VALIDATE_OPTIONS);
    expect(error).toBeUndefined();
    expect(value.kisisel.hobiler).toEqual([]);
  });
});
