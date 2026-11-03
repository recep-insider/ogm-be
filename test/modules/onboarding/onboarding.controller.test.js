'use strict';

jest.mock('../../../src/modules/onboarding/onboarding.service', () => ({
  complete: jest.fn(async () => ({ applicationId: 'app1' })),
}));

const onboardingService = require('../../../src/modules/onboarding/onboarding.service');
const controller = require('../../../src/modules/onboarding/onboarding.controller');

function payload() {
  return {
    kimlik: { tcKimlik: '10000000146', ad: 'Ali', soyad: 'Yılmaz', dogumTarihi: '1990-05-15' },
    iletisim: { eposta: 'ali@example.com', adres: 'Örnek Mah. Test Sok. No:1 Marmaris' },
    kisisel: { kanGrubu: 'A+', ogrenim: 'Lisans', meslek: 'Memur', hobiler: [] },
    acil: { ad: 'Ayşe', soyad: 'Yılmaz', telefon: '+905329876543', yakinlik: 'Eş' },
  };
}

function makeReq(extra) {
  return {
    body: { data: JSON.stringify(payload()) },
    files: {},
    ip: '1.2.3.4',
    headers: { 'user-agent': 'jest' },
    ...extra,
  };
}

function makeRes() {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
}

describe('onboarding.controller.complete — registrationToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('kayıt token akışında bearer token servise registrationToken olarak geçer', async () => {
    const registration = { sub: null, phone: '+905551112233' };
    const res = makeRes();

    await controller.complete(makeReq({ registration, token: 'kayit-token' }), res);

    expect(onboardingService.complete).toHaveBeenCalledTimes(1);
    const args = onboardingService.complete.mock.calls[0][0];
    expect(args.registration).toBe(registration);
    expect(args.registrationToken).toBe('kayit-token');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('access token kullanıcısında registrationToken null', async () => {
    await controller.complete(makeReq({ user: { id: 'u1' }, token: 'access-token' }), makeRes());

    const args = onboardingService.complete.mock.calls[0][0];
    expect(args.user).toEqual({ id: 'u1' });
    expect(args.registration).toBeNull();
    expect(args.registrationToken).toBeNull();
  });
});
