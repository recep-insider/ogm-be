'use strict';

describe('assetUrl', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    jest.resetModules();
  });

  function load() {
    jest.resetModules();
    return require('../../src/shared/asset-url').assetUrl;
  }

  it('null → null', () => {
    const assetUrl = load();
    expect(assetUrl(null)).toBeNull();
  });

  it('http(s) ile başlayan değer olduğu gibi döner', () => {
    const assetUrl = load();
    expect(assetUrl('https://cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg');
  });

  it('publicBaseUrl varsa onu prefix eder', () => {
    process.env.UPLOAD_PUBLIC_BASE_URL = 'https://cdn.recepbiyikli.com/uploads/';
    const assetUrl = load();
    expect(assetUrl('seed/blog/x.jpg')).toBe('https://cdn.recepbiyikli.com/uploads/seed/blog/x.jpg');
  });

  it('publicBaseUrl yoksa API_URL base kullanılır', () => {
    process.env.UPLOAD_PUBLIC_BASE_URL = '';
    process.env.API_URL = 'https://api.recepbiyikli.com';
    const assetUrl = load();
    expect(assetUrl('/seed/x.jpg')).toBe('https://api.recepbiyikli.com/seed/x.jpg');
  });

  it('onboarding/ belgeleri 15 dk geçerli imzalı URL döner; diğer klasörler imzasız', () => {
    process.env.UPLOAD_PUBLIC_BASE_URL = 'https://api.test/uploads';
    const assetUrl = load();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const signed = assetUrl('onboarding/saglik.pdf');
    expect(signed).toMatch(/^https:\/\/api\.test\/uploads\/onboarding\/saglik\.pdf\?exp=1700000900&sig=[\w-]{43}$/);
    expect(assetUrl('avatars/u1.jpg')).toBe('https://api.test/uploads/avatars/u1.jpg');
    expect(assetUrl('missions/p.jpg')).toBe('https://api.test/uploads/missions/p.jpg');
    jest.restoreAllMocks();
  });
});
