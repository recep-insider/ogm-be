'use strict';

// bcrypt native binding'i bu test makinesinde yüklenemiyor; getOtpForPhone onu
// kullanmıyor (yalnızca require zincirinde geliyor), bu yüzden factory ile
// mock'layıp gerçek modülün hiç yüklenmemesini sağlıyoruz.
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('phone.service — getOtpForPhone / isDummyPhone', () => {
  let env;
  let svc;

  beforeEach(() => {
    jest.resetModules();
    env = require('../../../src/config/env');
    svc = require('../../../src/modules/auth/phone.service');
  });

  test('isDummyPhone yalnızca yapılandırılmış numaraları tanır', () => {
    env.sms.dummyPhones = ['+905555555555'];
    expect(svc.isDummyPhone('+905555555555')).toBe(true);
    expect(svc.isDummyPhone('+905321112233')).toBe(false);
  });

  test('getOtpForPhone dummy numara için sabit kodu döner', () => {
    env.sms.dummyPhones = ['+905555555555'];
    env.sms.dummyCode = '123456';
    expect(svc.getOtpForPhone('+905555555555')).toBe('123456');
  });

  test('getOtpForPhone normal numara için otpLength uzunluğunda rakamsal kod üretir', () => {
    env.sms.dummyPhones = [];
    env.sms.otpLength = 6;

    const code = svc.getOtpForPhone('+905321112233');

    expect(code).toMatch(/^\d{6}$/);
  });
});
