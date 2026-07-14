'use strict';

// loginSchema / refreshSchema alan politikası birim testi. Şemalar hiçbir I/O
// yapmaz; doğrudan validate edilir (route testlerinde transitif olarak da geçer).

const { loginSchema, refreshSchema } = require('../../../src/modules/admin/auth/adminAuth.validators');

describe('adminAuth.validators — loginSchema', () => {
  test('geçerli e-posta + şifre kabul edilir', () => {
    const { error } = loginSchema.validate({ eposta: 'admin@ogm.gov.tr', sifre: 'password1' });
    expect(error).toBeUndefined();
  });

  test('geçersiz e-posta reddedilir', () => {
    const { error } = loginSchema.validate({ eposta: 'nope', sifre: 'password1' });
    expect(error).toBeDefined();
    expect(error.details[0].path).toContain('eposta');
  });

  test('8 karakterden kısa şifre reddedilir', () => {
    const { error } = loginSchema.validate({ eposta: 'admin@ogm.gov.tr', sifre: 'short' });
    expect(error).toBeDefined();
    expect(error.details[0].message).toMatch(/en az 8/i);
  });

  test('eposta zorunludur', () => {
    const { error } = loginSchema.validate({ sifre: 'password1' });
    expect(error).toBeDefined();
  });

  test('sifre zorunludur', () => {
    const { error } = loginSchema.validate({ eposta: 'admin@ogm.gov.tr' });
    expect(error).toBeDefined();
  });
});

describe('adminAuth.validators — refreshSchema', () => {
  test('refreshToken string kabul edilir', () => {
    const { error } = refreshSchema.validate({ refreshToken: 'abc.def.ghi' });
    expect(error).toBeUndefined();
  });

  test('refreshToken eksikse reddedilir', () => {
    const { error } = refreshSchema.validate({});
    expect(error).toBeDefined();
  });
});
