'use strict';

// KVKK Article 11 export: fire reports carry the location fields and the same computed
// title the volunteer sees in the app.

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

const mockSelects = {};
const mockTables = {
  users: { id: 'u1', ad: 'Ali', hobiler: '[]' },
  applications: [],
  consents: [],
  devices: [],
  fire_reports: [
    {
      id: 'fr1',
      latitude: '36.85',
      longitude: '28.27',
      description: 'Duman',
      status: 'confirmed',
      created_at: new Date('2026-06-09T14:23:00Z'),
      location_name: 'Marmaris',
      postal_code: '48700',
      il: 'Muğla',
      ilce: 'Marmaris',
    },
  ],
};

jest.mock('../../../src/config/db', () => ({
  db: Object.assign(
    jest.fn((table) => {
      const c = {
        where: jest.fn(() => c),
        first: jest.fn(async () => mockTables[table]),
        select: jest.fn(async (...cols) => {
          mockSelects[table] = cols;
          return mockTables[table];
        }),
      };
      return c;
    }),
    { raw: jest.fn() },
  ),
}));
jest.mock('../../../src/config/redis', () => ({ redis: { incr: jest.fn(), expire: jest.fn() } }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/fireReports/fireReports.service', () => ({
  titlesFor: jest.fn(async (rows) => new Map(rows.map((r) => [r.id, `[${r.postal_code}] ${r.il}, ${r.ilce}`]))),
}));

const { dataExport } = require('../../../src/modules/users/users.service');
const { titlesFor } = require('../../../src/modules/fireReports/fireReports.service');

describe('users.service — dataExport fire reports', () => {
  it('selects the location columns and adds the computed title', async () => {
    const out = await dataExport('u1');

    expect(mockSelects.fire_reports).toEqual(
      expect.arrayContaining(['location_name', 'postal_code', 'il', 'ilce']),
    );
    expect(out.fireReports[0]).toMatchObject({
      id: 'fr1',
      location_name: 'Marmaris',
      postal_code: '48700',
      il: 'Muğla',
      ilce: 'Marmaris',
      title: '[48700] Muğla, Marmaris',
    });
  });

  it('skips titlesFor and returns an empty list when the user has no fire reports', async () => {
    const saved = mockTables.fire_reports;
    mockTables.fire_reports = [];
    titlesFor.mockClear();
    try {
      const out = await dataExport('u1');

      expect(titlesFor).not.toHaveBeenCalled();
      expect(out.fireReports).toEqual([]);
    } finally {
      mockTables.fire_reports = saved;
    }
  });

  it('sets title to null when titlesFor has no entry for a report', async () => {
    titlesFor.mockResolvedValueOnce(new Map());

    const out = await dataExport('u1');

    expect(out.fireReports[0]).toMatchObject({ id: 'fr1', title: null });
  });
});
