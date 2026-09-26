'use strict';

// Panel volunteer search matches TC kimlik as well, so the officer can find a volunteer
// whose QR cannot be scanned.

const mockLikeColumns = [];

jest.mock('../../../src/config/db', () => {
  const makeChain = (state = { counting: false }) => {
    const c = {};
    const passthrough = ['leftJoin', 'whereNull', 'select', 'orderBy', 'limit', 'offset', 'on', 'andOn'];
    for (const m of passthrough) c[m] = jest.fn(() => c);
    c.leftJoin = jest.fn((_t, fn) => {
      if (typeof fn === 'function') fn.call(c);
      return c;
    });
    const recordWhere = (col, op) => {
      if (op === 'like') mockLikeColumns.push(col);
    };
    c.where = jest.fn((col, op) => {
      if (typeof col === 'function') col(c);
      else recordWhere(col, op);
      return c;
    });
    c.orWhere = jest.fn((col, op) => {
      recordWhere(col, op);
      return c;
    });
    c.clone = jest.fn(() => makeChain({ counting: false }));
    c.count = jest.fn(() => {
      state.counting = true;
      return c;
    });
    c.then = (resolve, reject) =>
      Promise.resolve(state.counting ? [{ total: 0 }] : []).then(resolve, reject);
    return c;
  };
  const db = Object.assign(jest.fn(() => makeChain()), { raw: jest.fn(() => 'raw') });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const { listVolunteers } = require('../../../src/modules/admin/admin.service');

describe('admin.service — listVolunteers search', () => {
  it('matches name, phone, e-mail and TC kimlik', async () => {
    const result = await listVolunteers({ q: '10000000146' });

    expect(result).toMatchObject({ items: [], total: 0 });
    expect(mockLikeColumns).toEqual(
      expect.arrayContaining(['u.ad', 'u.soyad', 'u.phone', 'u.eposta', 'u.tc_kimlik']),
    );
  });
});
