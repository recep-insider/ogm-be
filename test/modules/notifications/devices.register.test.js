'use strict';

// BUG-025: aynı FCM token eş zamanlı iki kez kaydedilirse ikinci istek 500 almaz.

const mockState = { existing: null, dupOnce: false, updates: [], inserts: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    const c = {
      where: jest.fn(() => c),
      first: jest.fn(async () => mockState.existing),
      update: jest.fn(async (row) => {
        mockState.updates.push(row);
        return 1;
      }),
      insert: jest.fn(async (row) => {
        if (mockState.dupOnce) {
          mockState.dupOnce = false;
          mockState.existing = { id: 'd-diger', user_id: 'u1' };
          throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        }
        mockState.inserts.push(row);
        return [1];
      }),
    };
    return c;
  };
  return { db: Object.assign(jest.fn(() => makeChain()), { raw: jest.fn() }) };
});

const { registerDevice } = require('../../../src/modules/notifications/notifications.service');

beforeEach(() => {
  Object.assign(mockState, { existing: null, dupOnce: false, updates: [], inserts: [] });
});

describe('registerDevice', () => {
  it('yeni token kaydedilir', async () => {
    const res = await registerDevice('u1', { token: 'tok', platform: 'ios' });
    expect(res.id).toEqual(expect.any(String));
    expect(mockState.inserts).toHaveLength(1);
  });

  it('eş zamanlı istek token\'ı kaydettiyse mevcut kayıt güncellenir, 500 yok', async () => {
    mockState.dupOnce = true;
    const res = await registerDevice('u1', { token: 'tok', platform: 'android', appVersion: '1.3' });

    expect(res).toEqual({ id: 'd-diger' });
    expect(mockState.inserts).toHaveLength(0);
    expect(mockState.updates[0]).toMatchObject({ user_id: 'u1', platform: 'android', app_version: '1.3' });
  });
});
