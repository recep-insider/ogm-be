'use strict';

// backend §10 / mobil §4 — "SOS'u iptal et" sinyalinin sahibi gönüllüdür.

const mockState = { row: null, updates: [], history: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      orderBy: jest.fn(() => c),
      first: jest.fn(async () => (table === 'sos_reports' ? mockState.row : undefined)),
      update: jest.fn(async (row) => {
        mockState.updates.push(row);
        return 1;
      }),
      insert: jest.fn(async (row) => {
        if (table === 'sos_history') mockState.history.push(row);
        return [1];
      }),
      // Geçmiş sorgusu await edilir — zincir thenable olmalı.
      then: (resolve, reject) => Promise.resolve(mockState.history).then(resolve, reject),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/config/redis', () => ({ redis: { incr: jest.fn(), expire: jest.fn() } }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const service = require('../../../src/modules/sos/sos.service');

describe('sos.cancel', () => {
  beforeEach(() => {
    mockState.row = { id: 's1', user_id: 'u1', status: 'active', created_at: new Date() };
    mockState.updates = [];
    mockState.history = [];
    jest.clearAllMocks();
  });

  it('gönüllü kendi açık çağrısını iptal eder, geçmişe mobil satırı düşer', async () => {
    const result = await service.cancel('s1', { userId: 'u1' });

    expect(result).toMatchObject({ ok: true, sosId: 's1', status: 'cancelled' });
    expect(mockState.updates[0].status).toBe('cancelled');
    expect(mockState.history[0]).toMatchObject({ by_kind: 'mobil' });
  });

  it('başkasının çağrısı iptal edilemez', async () => {
    await expect(service.cancel('s1', { userId: 'u2' })).rejects.toMatchObject({ status: 403 });
    expect(mockState.updates).toHaveLength(0);
  });

  it('kapanmış çağrı tekrar iptal edilemez', async () => {
    mockState.row.status = 'responded';
    await expect(service.cancel('s1', { userId: 'u1' })).rejects.toMatchObject({
      status: 409,
      code: 'sos_not_active',
    });
  });
});

describe('sos.adminAddHistory', () => {
  beforeEach(() => {
    mockState.row = { id: 's1', user_id: 'u1', status: 'active', created_at: new Date() };
    mockState.updates = [];
    mockState.history = [];
    jest.clearAllMocks();
  });

  it('"müdahale edildi" aksiyonu geçmişi ve durumu TEK çağrıda günceller', async () => {
    const result = await service.adminAddHistory('s1', { action: 'responded', by: 'Operatör A' }, {});

    expect(result.status).toBe('responded');
    expect(mockState.updates[0]).toMatchObject({ status: 'responded' });
    expect(mockState.history[0]).toMatchObject({
      event: 'Müdahale edildi olarak işaretlendi',
      by: 'Operatör A',
      by_kind: 'operator',
    });
  });

  it('arama aksiyonu durumu değiştirmez, yalnızca geçmişe satır düşer', async () => {
    const result = await service.adminAddHistory('s1', { action: 'called_112' }, {});

    expect(result.status).toBe('active');
    expect(mockState.updates).toHaveLength(0);
  });

  it('gönüllünün iptal ettiği çağrıya operatör kaydı düşmez', async () => {
    mockState.row.status = 'cancelled';
    await expect(service.adminAddHistory('s1', { action: 'called_112' }, {})).rejects.toMatchObject({
      code: 'sos_cancelled',
    });
  });

  it('tanımsız aksiyon reddedilir', async () => {
    await expect(
      service.adminAddHistory('s1', { action: 'volunteer_safe' }, {}),
    ).rejects.toMatchObject({ status: 400 });
  });
});
