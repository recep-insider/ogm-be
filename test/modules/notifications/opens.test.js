'use strict';

// K5: bildirim okunma sayısı — bildirime dokunup uygulamayı açan tekil gönüllü.

const mockState = { log: [], opens: [], selects: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    let counting = false;
    const c = {
      where: jest.fn((cond) => {
        c.cond = cond;
        return c;
      }),
      clone: jest.fn(() => makeChain(table)),
      count: jest.fn(() => {
        counting = true;
        return c;
      }),
      select: jest.fn((...cols) => {
        mockState.selects.push(cols);
        return c;
      }),
      orderBy: jest.fn(() => c),
      limit: jest.fn(() => c),
      offset: jest.fn(() => c),
      first: jest.fn(async () => mockState.log.find((r) => r.id === c.cond?.id)),
      insert: jest.fn((row) => ({
        onConflict: (cols) => ({
          ignore: async () => {
            const dup = mockState.opens.some((o) => cols.every((k) => o[k] === row[k]));
            if (!dup) mockState.opens.push(row);
          },
        }),
      })),
      then: (resolve, reject) =>
        Promise.resolve(counting ? [{ total: mockState.log.length }] : mockState.log).then(resolve, reject),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn((sql) => ({ sql })) });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/shared/sms-provider', () => ({ sendSms: jest.fn() }));

const { markOpened } = require('../../../src/modules/notifications/notifications.service');
const { history } = require('../../../src/modules/notifications/dispatch.service');
const migration = require('../../../migrations/20261104110000_create_notification_opens');

const LOG = { id: 'n1', category: 'bilgi', title: 'Duyuru', body: 'x', target: '{"kind":"general","audience":"tumu"}', push_count: 3, sms_count: 0, sent_at: new Date() };

beforeEach(() => {
  mockState.log = [{ ...LOG }];
  mockState.opens = [];
  mockState.selects = [];
});

describe('markOpened', () => {
  it('açılışı kaydeder; aynı gönüllünün ikinci açılışı sayılmaz', async () => {
    await markOpened('u1', 'n1');
    await markOpened('u1', 'n1');
    await markOpened('u2', 'n1');

    expect(mockState.opens.map((o) => [o.notification_id, o.user_id])).toEqual([['n1', 'u1'], ['n1', 'u2']]);
  });

  it('olmayan bildirim 404 notification_not_found', async () => {
    await expect(markOpened('u1', 'yok')).rejects.toMatchObject({ status: 404, code: 'notification_not_found' });
    expect(mockState.opens).toHaveLength(0);
  });
});

describe('history openCount', () => {
  it('her bildirimde tekil açılış sayısı döner, açılmayan 0', async () => {
    mockState.log = [{ ...LOG, open_count: '2' }, { ...LOG, id: 'n2', open_count: null }];

    const { items } = await history({});

    expect(items.map((i) => [i.id, i.openCount])).toEqual([['n1', 2], ['n2', 0]]);
    expect(JSON.stringify(mockState.selects)).toContain('notification_opens');
  });
});

describe('migration — notification_opens', () => {
  it('bildirim + gönüllü başına tek satır; down tabloyu siler', async () => {
    const cols = [];
    const col = {};
    for (const m of ['notNullable', 'references', 'inTable', 'onDelete', 'defaultTo']) col[m] = () => col;
    const t = {
      string: (name) => (cols.push(name), col),
      timestamp: (name) => (cols.push(name), col),
      primary: jest.fn(),
    };
    const knex = {
      fn: { now: () => 'now' },
      schema: { createTable: jest.fn(async (_name, fn) => fn(t)), dropTableIfExists: jest.fn() },
    };

    await migration.up(knex);
    expect(knex.schema.createTable).toHaveBeenCalledWith('notification_opens', expect.any(Function));
    expect(cols).toEqual(['notification_id', 'user_id', 'opened_at']);
    expect(t.primary).toHaveBeenCalledWith(['notification_id', 'user_id']);

    await migration.down(knex);
    expect(knex.schema.dropTableIfExists).toHaveBeenCalledWith('notification_opens');
  });
});
