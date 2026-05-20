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
});
