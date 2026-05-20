'use strict';

describe('env config — dummy OTP', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('OTP_DUMMY_PHONES virgülle ayrılır, trim ve boş eleman filtresi uygulanır', () => {
    process.env.OTP_DUMMY_PHONES = ' +905555555555 , +905554443322 ,';
    const env = require('../../src/config/env');
    expect(env.sms.dummyPhones).toEqual(['+905555555555', '+905554443322']);
  });

  test('OTP_DUMMY_PHONES boşsa boş dizi döner', () => {
    process.env.OTP_DUMMY_PHONES = '';
    const env = require('../../src/config/env');
    expect(env.sms.dummyPhones).toEqual([]);
  });

  test('OTP_DUMMY_CODE verilmezse 123456 default kullanılır', () => {
    delete process.env.OTP_DUMMY_CODE;
    const env = require('../../src/config/env');
    expect(env.sms.dummyCode).toBe('123456');
  });

  test('OTP_DUMMY_CODE verildiğinde override edilir', () => {
    process.env.OTP_DUMMY_CODE = '999000';
    const env = require('../../src/config/env');
    expect(env.sms.dummyCode).toBe('999000');
  });
});
