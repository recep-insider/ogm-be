'use strict';

const mockCalls = [];

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const chain = { table, wheres: [] };
    for (const method of ['join', 'whereNull', 'select', 'count', 'groupBy', 'on', 'andOn']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.where = jest.fn((...args) => {
      chain.wheres.push(args);
      return chain;
    });
    chain.first = jest.fn(() => Promise.resolve({ c: 0 }));
    chain.then = (resolve, reject) => Promise.resolve([]).then(resolve, reject);
    return chain;
  };
  const dbFn = jest.fn((table) => {
    const chain = makeChain(table);
    mockCalls.push(chain);
    return chain;
  });
  dbFn.raw = jest.fn((sql) => ({ __raw: sql }));
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({}));

const { dashboardSummary } = require('../../../src/modules/admin/admin.service');

const todayBound = (table) => mockCalls
  .filter((c) => c.table === table)
  .flatMap((c) => c.wheres)
  .find(([col]) => col === 'created_at');

describe('admin.service — dashboardSummary bugün sayaçları', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    jest.useFakeTimers({ now: new Date('2026-11-02T22:30:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => jest.useRealTimers());

  test.each(['fire_reports', 'emergency_reports'])('%s bugün sayacı Türkiye gece yarısından sayar', async (table) => {
    await dashboardSummary();
    const [, op, bound] = todayBound(table);
    expect(op).toBe('>=');
    expect(bound).toBeInstanceOf(Date);
    expect(bound.toISOString()).toBe('2026-11-02T21:00:00.000Z');
  });
});
