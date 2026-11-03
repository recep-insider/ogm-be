'use strict';

// backend §10 / mobil §4 — "SOS'u iptal et" sinyalinin sahibi gönüllüdür.

const mockState = { row: null, updates: [], history: [], updateCount: 1 };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      where: jest.fn(() => c),
      forUpdate: jest.fn(() => c),
      orderBy: jest.fn(() => c),
      first: jest.fn(async () => (table === 'sos_reports' ? mockState.row : undefined)),
      update: jest.fn(async (row) => {
        mockState.updates.push(row);
        return mockState.updateCount;
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
  db.transaction = jest.fn(async (cb) => cb(db));
  return { db };
});
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn(async () => ({ sent: 1 })) }));
jest.mock('../../../src/config/redis', () => ({ redis: { incr: jest.fn(), expire: jest.fn() } }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const service = require('../../../src/modules/sos/sos.service');

describe('sos.cancel', () => {
  beforeEach(() => {
    mockState.row = { id: 's1', user_id: 'u1', status: 'active', created_at: new Date() };
    mockState.updateCount = 1;
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

  it('eş zamanlı ikinci iptal yazmaz: koşullu güncelleme 0 satır → 409, ikinci geçmiş satırı yok (BUG-025)', async () => {
    const { db } = require('../../../src/config/db');
    const updateZero = { where: jest.fn(() => updateZero), update: jest.fn(async () => 0) };
    db.mockImplementationOnce(() => ({ where: () => ({ first: async () => mockState.row }) }));
    db.mockImplementationOnce(() => updateZero);

    await expect(service.cancel('s1', { userId: 'u1' })).rejects.toMatchObject({ status: 409, code: 'sos_not_active' });
    expect(updateZero.where).toHaveBeenCalledWith({ id: 's1', status: 'active' });
    expect(mockState.history).toHaveLength(0);
  });

  it('okuma ile yazma arasında operatör müdahale ettiyse iptal onun kaydını ezmez: 409, geçmiş yok', async () => {
    mockState.updateCount = 0;
    await expect(service.cancel('s1', { userId: 'u1' })).rejects.toMatchObject({ status: 409, code: 'sos_not_active' });
    expect(mockState.history).toHaveLength(0);
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
    mockState.updateCount = 1;
    mockState.updates = [];
    mockState.history = [];
    jest.clearAllMocks();
  });

  it('"müdahale edildi" aksiyonu geçmişi ve durumu TEK çağrıda günceller', async () => {
    // BUG-060: "işlemi yapan" oturumdaki kullanıcıdır; gövdedeki by yok sayılır.
    const result = await service.adminAddHistory('s1', { action: 'responded', by: 'Sahte Ad' }, { name: 'Operatör A' });

    expect(result.status).toBe('responded');
    expect(mockState.updates[0]).toMatchObject({ status: 'responded' });
    expect(mockState.history[0]).toMatchObject({
      event: 'Müdahale edildi olarak işaretlendi',
      by: 'Operatör A',
      by_kind: 'operator',
    });
  });

  it('serbest not durumu değiştirmez, yalnızca geçmişe satır düşer', async () => {
    const result = await service.adminAddHistory('s1', { note: '112 arandı' }, {});

    expect(result.status).toBe('active');
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.history[0]).toMatchObject({ event: '112 arandı', by_kind: 'operator' });
  });

  it('"müdahale edildi" kaydı kesinleşince gönüllüye sos_responded bildirimi gider', async () => {
    const { sendPushToUser } = require('../../../src/shared/push-provider');
    await service.adminAddHistory('s1', { action: 'responded' }, {});

    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.objectContaining({
      topic: 'acil',
      data: { type: 'sos_responded', sosId: 's1' },
    }));
  });

  it('serbest not gönüllüye bildirim göndermez', async () => {
    const { sendPushToUser } = require('../../../src/shared/push-provider');
    await service.adminAddHistory('s1', { note: '112 arandı' }, {});
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('bildirim gönderilemese de kayıt başarılı döner', async () => {
    const { sendPushToUser } = require('../../../src/shared/push-provider');
    sendPushToUser.mockRejectedValueOnce(new Error('fcm down'));
    await expect(service.adminAddHistory('s1', { action: 'responded' }, {})).resolves.toMatchObject({ status: 'responded' });
  });

  it.each([[{ note: 'sonradan not' }], [{ action: 'responded' }]])(
    'kapanmış (müdahale edilmiş) çağrıya %p 409 sos_not_active; kayıt ve bildirim yok',
    async (body) => {
      const { sendPushToUser } = require('../../../src/shared/push-provider');
      mockState.row.status = 'responded';
      await expect(service.adminAddHistory('s1', body, {})).rejects.toMatchObject({ status: 409, code: 'sos_not_active' });
      expect(mockState.history).toHaveLength(0);
      expect(mockState.updates).toHaveLength(0);
      expect(sendPushToUser).not.toHaveBeenCalled();
    },
  );

  it('gönüllünün iptal ettiği çağrıya operatör kaydı düşmez', async () => {
    mockState.row.status = 'cancelled';
    await expect(service.adminAddHistory('s1', { note: 'not' }, {})).rejects.toMatchObject({
      code: 'sos_cancelled',
    });
  });

  it.each([['volunteer_safe'], ['called_volunteer'], ['called_112']])(
    'tanımsız aksiyon (%s) reddedilir',
    async (action) => {
      await expect(service.adminAddHistory('s1', { action }, {})).rejects.toMatchObject({
        status: 400,
      });
      expect(mockState.history).toHaveLength(0);
    },
  );
});
