'use strict';

// Panel gönüllü araması: her kelime ayrı ayrı (AND) eşleşmeli, Türkçe İ/ı katlanır,
// TC kimlik (QR okutulamayan gönüllü), il/ilçe ve STK da aranır.

const mockRaw = [];

jest.mock('../../../src/config/db', () => {
  const makeChain = (state = { counting: false }) => {
    const c = {};
    const passthrough = ['whereNull', 'where', 'select', 'orderBy', 'limit', 'offset', 'on', 'andOn'];
    for (const m of passthrough) c[m] = jest.fn(() => c);
    c.leftJoin = jest.fn((_t, fn) => {
      if (typeof fn === 'function') fn.call(c);
      return c;
    });
    c.whereRaw = jest.fn((sql, bindings) => {
      mockRaw.push({ sql, bindings });
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

const search = async (q) => {
  mockRaw.length = 0;
  await listVolunteers({ q });
  return mockRaw;
};

describe('admin.service — listVolunteers search', () => {
  it('tek ifadede ad, soyad, telefon, e-posta, TC, il, ilçe ve STK aranır', async () => {
    const [clause] = await search('10000000146');

    for (const column of ['u.ad', 'u.soyad', 'u.phone', 'u.eposta', 'u.tc_kimlik', 'u.il', 'u.ilce', 'u.stk_text']) {
      expect(clause.sql).toContain(column);
    }
    expect(clause.sql).toMatch(/^REPLACE\(LOWER\(CONCAT_WS\(.*\)\), 'ı', 'i'\) LIKE \?$/);
    expect(clause.bindings).toEqual(['%10000000146%']);
  });

  it('her kelime ayrı koşul olur (AND): "ismail kaya"', async () => {
    const clauses = await search('  ismail   kaya ');
    expect(clauses.map((c) => c.bindings)).toEqual([['%ismail%'], ['%kaya%']]);
  });

  it('Türkçe büyük/küçük harf katlanır: İ → i, I → i, ı → i', async () => {
    const clauses = await search('İSMAİL IŞIK ılgaz');
    expect(clauses.map((c) => c.bindings[0])).toEqual(['%ismail%', '%işik%', '%ilgaz%']);
  });

  it('il, ilçe ve STK adı da tek başına aranabilir', async () => {
    const clauses = await search('Kahramanmaraş Afşin AKUT');
    expect(clauses.map((c) => c.bindings[0])).toEqual(['%kahramanmaraş%', '%afşin%', '%akut%']);
  });

  it('LIKE jokerleri (% _ \\) kaçırılır', async () => {
    const [clause] = await search('50%_a\\b');
    expect(clause.bindings).toEqual(['%50\\%\\_a\\\\b%']);
  });

  it('boş ya da yalnız boşluk sorgu filtre eklemez', async () => {
    expect(await search('   ')).toEqual([]);
    expect(await search(undefined)).toEqual([]);
  });
});
