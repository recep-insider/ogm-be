'use strict';

// il is validated/normalised against the 81 provinces in shared/regions.js for both
// PATCH /users/me and onboarding iletisim; ilce stays free text (trimmed, max 60).

const { patchMeSchema } = require('../../../src/modules/users/users.validators');
const { onboardingSchema } = require('../../../src/modules/onboarding/onboarding.validators');

const OPTS = { abortEarly: false, stripUnknown: true, convert: true };

describe('PATCH /users/me — il', () => {
  it.each([
    ['istanbul', 'İstanbul'],
    ['  IZMIR ', 'İzmir'],
    ['hakkari', 'Hakkâri'],
    ['Şanlıurfa', 'Şanlıurfa'],
    ['sanliurfa', 'Şanlıurfa'],
  ])('normalises %p to %p', (input, canonical) => {
    const { error, value } = patchMeSchema.validate({ il: input }, OPTS);
    expect(error).toBeUndefined();
    expect(value.il).toBe(canonical);
  });

  it('rejects an unknown province', () => {
    const { error } = patchMeSchema.validate({ il: 'Atlantis' }, OPTS);
    expect(error.details[0]).toMatchObject({ path: ['il'], type: 'any.invalid' });
  });

  it('still allows clearing il with null or empty string', () => {
    expect(patchMeSchema.validate({ il: null }, OPTS).error).toBeUndefined();
    expect(patchMeSchema.validate({ il: '' }, OPTS).error).toBeUndefined();
  });

  it('trims ilce and caps it at 60 characters', () => {
    expect(patchMeSchema.validate({ ilce: '  Marmaris ' }, OPTS).value.ilce).toBe('Marmaris');
    expect(patchMeSchema.validate({ ilce: 'x'.repeat(61) }, OPTS).error).toBeDefined();
  });
});

describe('onboarding iletisim — il', () => {
  const payload = (il) => ({
    kimlik: { tcKimlik: '10000000146', ad: 'Ali', soyad: 'Yılmaz', dogumTarihi: '1990-05-15' },
    iletisim: { eposta: 'ali@example.com', il, ilce: ' Marmaris ' },
    kisisel: { kanGrubu: 'A+', ogrenim: 'Lisans', meslek: 'Memur', hobiler: [] },
    acil: { ad: 'Ayşe', soyad: 'Yılmaz', telefon: '+905329876543', yakinlik: 'Eş' },
  });

  it('normalises il to the canonical spelling and trims ilce', () => {
    const { error, value } = onboardingSchema.validate(payload('mugla'), OPTS);
    expect(error).toBeUndefined();
    expect(value.iletisim).toMatchObject({ il: 'Muğla', ilce: 'Marmaris' });
  });

  it('rejects an unknown province', () => {
    const { error } = onboardingSchema.validate(payload('Gotham'), OPTS);
    expect(error.details.some((d) => d.path.join('.') === 'iletisim.il')).toBe(true);
  });
});
