'use strict';

// Elle tetiklenen KVKK koşusu: başarısız hesap varsa çıkış kodu 1 olmalı (aksi halde
// operatör "temiz koşu" sanar); her durumda DB ve Redis bağlantısı kapanmalı.

jest.mock('../../src/config/db', () => ({ db: { destroy: jest.fn(async () => {}) } }));
jest.mock('../../src/config/redis', () => ({ closeRedis: jest.fn(async () => {}) }));
jest.mock('../../src/modules/users/anonymize.service', () => ({ runExclusive: jest.fn() }));

const { db } = require('../../src/config/db');
const { closeRedis } = require('../../src/config/redis');
const { runExclusive } = require('../../src/modules/users/anonymize.service');
const { main } = require('../../scripts/anonymize-deleted-users');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  jest.restoreAllMocks();
});

describe('scripts/anonymize-deleted-users', () => {
  it('temiz koşuda 0 ile çıkar ve bağlantıları kapatır', async () => {
    runExclusive.mockResolvedValueOnce({ due: 2, anonymized: 2, failed: [] });

    await main();

    expect(process.exitCode).toBeUndefined();
    expect(db.destroy).toHaveBeenCalledTimes(1);
    expect(closeRedis).toHaveBeenCalledTimes(1);
  });

  it('başarısız hesap varsa çıkış kodu 1', async () => {
    runExclusive.mockResolvedValueOnce({ due: 2, anonymized: 1, failed: ['u9'] });

    await main();

    expect(process.exitCode).toBe(1);
  });

  it('kilit başka koşudaysa hata saymaz', async () => {
    runExclusive.mockResolvedValueOnce({ skipped: true });

    await main();

    expect(process.exitCode).toBeUndefined();
    expect(db.destroy).toHaveBeenCalledTimes(1);
  });

  it('iş hata fırlatsa da bağlantıları kapatır', async () => {
    runExclusive.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(main()).rejects.toThrow('ECONNREFUSED');
    expect(db.destroy).toHaveBeenCalledTimes(1);
    expect(closeRedis).toHaveBeenCalledTimes(1);
  });
});
