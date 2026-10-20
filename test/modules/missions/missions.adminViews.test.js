'use strict';

// Panel görev listesi toplanma noktasını tek join ile taşır; katılımcı ucu sayaçları
// filtreden bağımsız tek GROUP BY ile sayar; mobil aktif detay onaylı saha
// fotoğraflarını tek sorguyla alır (SIM-1080: satır başına sorgu yok).

const mockState = { tables: {}, chains: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table, calls = []) => {
    const c = { table, calls };
    mockState.chains.push(c);
    const record = (name) =>
      jest.fn((...args) => {
        calls.push([name, ...args]);
        return c;
      });
    for (const name of ['where', 'whereIn', 'whereNull', 'join', 'leftJoin', 'select', 'orderBy', 'count', 'groupBy', 'limit', 'offset']) {
      c[name] = record(name);
    }
    c.clone = jest.fn(() => makeChain(table, [...calls]));
    c.first = jest.fn(async () => mockState.tables[table]?.first);
    c.then = (resolve, reject) => {
      const t = mockState.tables[table] || {};
      const rows = calls.some(([n]) => n === 'groupBy') ? t.grouped : calls.some(([n]) => n === 'count') ? t.counted : t.rows;
      return Promise.resolve(rows || []).then(resolve, reject);
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn((sql) => sql) });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({ getReadiness: jest.fn() }));
jest.mock('../../../src/modules/fireReports/fireReports.service', () => ({
  mediaForMission: jest.fn(async () => [{ reportId: 'fr1', url: 'https://api.test/reports/a.jpg' }]),
}));

const env = require('../../../src/config/env');
const service = require('../../../src/modules/missions/missions.service');

const chainsFor = (table) => mockState.chains.filter((c) => c.table === table);
const callsNamed = (chain, name) => chain.calls.filter(([n]) => n === name);

beforeEach(() => {
  mockState.tables = {};
  mockState.chains = [];
  env.upload.publicBaseUrl = 'https://api.test';
});

describe('adminList — toplanma noktası', () => {
  const mission = { id: 'm1', title: 'Marmaris', status: 'active', is_active: 1, il: 'Muğla' };

  it('noktayı tek leftJoin ile alır ve mapPoint biçiminde döner', async () => {
    mockState.tables['missions as m'] = {
      counted: [{ total: 2 }],
      rows: [
        {
          ...mission,
          ap_id: 'ap1',
          ap_name: 'Okul bahçesi',
          ap_address: null,
          ap_lat: '36.8600000',
          ap_lng: '28.2800000',
          ap_is_open: 1,
          ap_officer_name: 'Mehmet Kaya',
          ap_officer_phone: '+905321112233',
        },
        { ...mission, id: 'm2', ap_id: null },
      ],
    };

    const result = await service.adminList({});

    expect(result.items[0].assemblyPoint).toEqual({
      id: 'ap1',
      missionId: 'm1',
      name: 'Okul bahçesi',
      address: null,
      coordinates: { lat: 36.86, lng: 28.28 },
      isOpen: true,
      officerName: 'Mehmet Kaya',
      officerPhone: '+905321112233',
    });
    expect(result.items[1].assemblyPoint).toBeNull();

    const rowsQuery = chainsFor('missions as m').find((c) => callsNamed(c, 'limit').length);
    expect(callsNamed(rowsQuery, 'leftJoin')).toEqual([['leftJoin', 'assembly_points as ap', 'ap.mission_id', 'm.id']]);
    expect(chainsFor('assembly_points')).toHaveLength(0);
  });
});

describe('adminParticipants', () => {
  const participant = (over = {}) => ({
    id: 'p1',
    user_id: 'u1',
    mission_id: 'm1',
    status: 'sahada',
    ad: 'Ali',
    soyad: 'Yılmaz',
    phone: '+905551112233',
    called_at: new Date('2026-10-20T08:00:00Z'),
    responded_at: new Date('2026-10-20T08:05:00Z'),
    joined_at: new Date('2026-10-20T08:00:00Z'),
    on_site_at: new Date('2026-10-20T09:00:00Z'),
    completed_at: null,
    checked_in_at: new Date('2026-10-20T09:00:00Z'),
    ci_method: 'qr',
    ci_recorded_by: 'Saha Amiri',
    ...over,
  });

  beforeEach(() => {
    mockState.tables.missions = { first: { id: 'm1' } };
    mockState.tables.mission_participants = {
      grouped: [
        { status: 'cagrildi', c: 3 },
        { status: 'sahada', c: '1' },
      ],
    };
    mockState.tables['mission_participants as mp'] = {
      rows: [participant(), participant({ id: 'p2', user_id: 'u2', status: 'cagrildi', checked_in_at: null })],
    };
  });

  it('olay yoksa 404 mission_not_found', async () => {
    mockState.tables.missions = { first: undefined };
    await expect(service.adminParticipants('mx')).rejects.toMatchObject({ status: 404, code: 'mission_not_found' });
  });

  it('beş durumun sayacını döner, olmayanlar 0', async () => {
    const result = await service.adminParticipants('m1');

    expect(result.counts).toEqual({ cagrildi: 3, yolda: 0, sahada: 1, tamamladi: 0, katilamiyor: 0 });
  });

  it('satırı durum zaman damgaları ve check-in bilgisiyle eşler', async () => {
    const { items } = await service.adminParticipants('m1');

    expect(items[0]).toEqual({
      userId: 'u1',
      ad: 'Ali',
      soyad: 'Yılmaz',
      phone: '+905551112233',
      status: 'sahada',
      calledAt: '2026-10-20T08:00:00.000Z',
      respondedAt: '2026-10-20T08:05:00.000Z',
      joinedAt: '2026-10-20T08:00:00.000Z',
      onSiteAt: '2026-10-20T09:00:00.000Z',
      completedAt: null,
      checkIn: { checkedInAt: '2026-10-20T09:00:00.000Z', method: 'qr', recordedBy: 'Saha Amiri' },
    });
    expect(items[1].checkIn).toBeNull();
  });

  it('status filtresi yalnızca listeye uygulanır, sayaç sorgusuna uygulanmaz', async () => {
    await service.adminParticipants('m1', { status: 'sahada' });

    const [counts] = chainsFor('mission_participants');
    const [list] = chainsFor('mission_participants as mp');
    expect(callsNamed(counts, 'where')).toEqual([['where', { mission_id: 'm1' }]]);
    expect(callsNamed(counts, 'groupBy')).toEqual([['groupBy', 'status']]);
    expect(callsNamed(list, 'where')).toContainEqual(['where', 'mp.status', 'sahada']);
  });

  it('check-in bilgisini olay + gönüllü üzerinden tek join ile alır', async () => {
    await service.adminParticipants('m1');

    const [list] = chainsFor('mission_participants as mp');
    const [[, table, onFn]] = callsNamed(list, 'leftJoin');
    expect(table).toBe('check_ins as ci');
    const on = [];
    const builder = {
      on: (...a) => {
        on.push(a);
        return builder;
      },
      andOn: (...a) => {
        on.push(a);
        return builder;
      },
    };
    onFn.call(builder);
    expect(on).toEqual([
      ['ci.mission_id', '=', 'mp.mission_id'],
      ['ci.user_id', '=', 'mp.user_id'],
    ]);
    expect(chainsFor('check_ins')).toHaveLength(0);
  });
});

describe('getActive — onaylı saha fotoğrafları', () => {
  beforeEach(() => {
    mockState.tables.missions = {
      first: { id: 'm1', title: 'Marmaris', status: 'active', is_active: 1, gallery: '["missions/cover.jpg"]' },
    };
    mockState.tables.check_ins = { first: { c: 0 } };
    mockState.tables.mission_photos = {
      rows: [
        { id: 'ph1', file_path: 'missions/a.jpg', kind: 'image', submitted_at: new Date('2026-10-20T09:10:00Z') },
        { id: 'ph2', file_path: 'missions/b.mp4', kind: 'video', submitted_at: new Date('2026-10-20T09:20:00Z') },
      ],
    };
  });

  it('yalnızca onaylıları tek sorguyla alır ve photos olarak döner', async () => {
    const detail = await service.getActive('u1', 'm1');

    expect(detail.photos).toEqual([
      { id: 'ph1', url: 'https://api.test/missions/a.jpg', kind: 'image', createdAt: '2026-10-20T09:10:00.000Z' },
      { id: 'ph2', url: 'https://api.test/missions/b.mp4', kind: 'video', createdAt: '2026-10-20T09:20:00.000Z' },
    ]);
    const photoQueries = chainsFor('mission_photos');
    expect(photoQueries).toHaveLength(1);
    expect(callsNamed(photoQueries[0], 'where')).toEqual([['where', { mission_id: 'm1', status: 'approved' }]]);
  });

  it('galeriye onaylı görseller eklenir, videolar eklenmez', async () => {
    const detail = await service.getActive('u1', 'm1');

    expect(detail.gallery).toEqual([
      'https://api.test/missions/cover.jpg',
      'https://api.test/reports/a.jpg',
      'https://api.test/missions/a.jpg',
    ]);
  });

  it('onaylı fotoğraf yoksa photos boş, galeri değişmez', async () => {
    mockState.tables.mission_photos = { rows: [] };
    const detail = await service.getActive('u1', 'm1');

    expect(detail.photos).toEqual([]);
    expect(detail.gallery).toEqual(['https://api.test/missions/cover.jpg', 'https://api.test/reports/a.jpg']);
  });
});
