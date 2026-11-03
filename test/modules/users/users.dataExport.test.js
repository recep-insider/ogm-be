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
  sos_reports: [{
    id: 's1', status: 'responded', lat: '36.85', lng: '28.27', il: 'Muğla', ilce: 'Marmaris', message: null,
    created_at: new Date('2026-08-01T10:00:00Z'), responded_at: new Date('2026-08-01T10:05:00Z'),
  }],
  emergency_reports: [{ id: 'e1', mission_id: 'm1', lat: null, lng: null, message: 'Yardım', created_at: new Date('2026-08-02T10:00:00Z') }],
  'mission_participants as mp': [{
    mission_id: 'm1', ref_no: 'OGM-2026-000001', title: 'Marmaris Yangını', status: 'tamamladi',
    called_at: new Date('2026-08-03T10:00:00Z'), responded_at: null, joined_at: new Date('2026-08-03T10:01:00Z'),
  }],
  check_ins: [{ mission_id: 'm1', checked_in_at: new Date('2026-08-03T11:00:00Z'), method: 'qr' }],
  'saha_training_applications as a': [{
    training_id: 't1', title: 'Yangın Hattı', status: 'approved', attendance: 'katildi', created_at: new Date('2026-07-01T09:00:00Z'),
  }],
};

jest.mock('../../../src/config/db', () => ({
  db: Object.assign(
    jest.fn((table) => {
      const c = {
        where: jest.fn(() => c),
        leftJoin: jest.fn(() => c),
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

describe('users.service — dataExport K22 bölümleri', () => {
  it('SOS, acil bildirim, görev katılımı, check-in ve saha başvurularını okunur alan adlarıyla verir', async () => {
    const out = await dataExport('u1');

    expect(out.sosCalls).toEqual([{
      id: 's1', status: 'responded', createdAt: '2026-08-01T10:00:00.000Z', respondedAt: '2026-08-01T10:05:00.000Z',
      latitude: 36.85, longitude: 28.27, il: 'Muğla', ilce: 'Marmaris', message: null,
    }]);
    expect(out.emergencyReports).toEqual([{
      id: 'e1', missionId: 'm1', createdAt: '2026-08-02T10:00:00.000Z', latitude: null, longitude: null, message: 'Yardım',
    }]);
    expect(out.missionParticipation).toEqual([{
      missionId: 'm1', refNo: 'OGM-2026-000001', missionTitle: 'Marmaris Yangını', status: 'tamamladi',
      calledAt: '2026-08-03T10:00:00.000Z', respondedAt: null, joinedAt: '2026-08-03T10:01:00.000Z',
    }]);
    expect(out.checkIns).toEqual([{ missionId: 'm1', checkedInAt: '2026-08-03T11:00:00.000Z', method: 'qr' }]);
    expect(out.sahaTrainingApplications).toEqual([{
      trainingId: 't1', trainingTitle: 'Yangın Hattı', status: 'approved', attendance: 'katildi', appliedAt: '2026-07-01T09:00:00.000Z',
    }]);
  });
});
