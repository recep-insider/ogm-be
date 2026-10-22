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
    for (const name of ['where', 'whereIn', 'whereNull', 'join', 'leftJoin', 'select', 'orderBy', 'orderByRaw', 'count', 'groupBy', 'limit', 'offset']) {
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
    mockState.tables['mission_participants as mp'] = {
      grouped: [
        { status: 'cagrildi', c: 3 },
        { status: 'sahada', c: '1' },
      ],
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

    const [list, counts] = chainsFor('mission_participants as mp');
    expect(callsNamed(counts, 'where')).toEqual([['where', 'mp.mission_id', 'm1']]);
    expect(callsNamed(counts, 'groupBy')).toEqual([['groupBy', 'mp.status']]);
    expect(callsNamed(list, 'where')).toContainEqual(['where', 'mp.status', 'sahada']);
  });

  it('silinmiş (KVKK) kullanıcıları sayaçtan da listeden de çıkarır', async () => {
    await service.adminParticipants('m1');

    const [list, counts] = chainsFor('mission_participants as mp');
    for (const chain of [list, counts]) {
      expect(callsNamed(chain, 'join')).toContainEqual(['join', 'users as u', 'u.id', 'mp.user_id']);
      expect(callsNamed(chain, 'whereNull')).toEqual([['whereNull', 'u.deleted_at']]);
    }
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

  it('operatör medyası (gönüllüsü yok) gönüllü yüklemesiyle aynı sorgudan galeriye ve photos[]a girer', async () => {
    mockState.tables.mission_photos = {
      rows: [{ id: 'op1', file_path: 'missions/op.jpg', kind: 'image', submitted_at: new Date('2026-10-20T10:00:00Z'), user_id: null }],
    };

    const detail = await service.getActive('u1', 'm1');

    expect(detail.photos.map((p) => p.id)).toEqual(['op1']);
    expect(detail.gallery).toContain('https://api.test/missions/op.jpg');
    const [photoQuery] = chainsFor('mission_photos');
    expect(callsNamed(photoQuery, 'join')).toEqual([]);
    expect(callsNamed(photoQuery, 'leftJoin')).toEqual([]);
  });

  it('onaylı fotoğraf yoksa photos boş, galeri değişmez', async () => {
    mockState.tables.mission_photos = { rows: [] };
    const detail = await service.getActive('u1', 'm1');

    expect(detail.photos).toEqual([]);
    expect(detail.gallery).toEqual(['https://api.test/missions/cover.jpg', 'https://api.test/reports/a.jpg']);
  });
});

describe('refNo — olay gösteren her yanıtta', () => {
  const row = { id: 'm1', ref_no: 'OGM-2026-000042', title: 'Marmaris', short_location: 'Muğla', status: 'active', is_active: 1 };

  it('panel listesi', async () => {
    mockState.tables['missions as m'] = { counted: [{ total: 2 }], rows: [row, { ...row, id: 'm2', ref_no: null }] };

    const { items } = await service.adminList({});

    expect(items.map((m) => m.refNo)).toEqual(['OGM-2026-000042', null]);
  });

  it('mobil aktif liste ve detay', async () => {
    mockState.tables.missions = { rows: [row], first: row };
    mockState.tables.check_ins = { first: { c: 0 } };

    expect((await service.listActive('u1'))[0].refNo).toBe('OGM-2026-000042');
    expect((await service.getActive('u1', 'm1')).refNo).toBe('OGM-2026-000042');
  });

  it('mobil görev geçmişi liste ve detay', async () => {
    mockState.tables.missions = { rows: [{ ...row, user_status: 'tamamladi' }], first: row };
    mockState.tables.mission_participants = { first: { status: 'tamamladi' } };
    mockState.tables.check_ins = { first: { c: 3 } };

    expect((await service.listHistory('u1'))[0].refNo).toBe('OGM-2026-000042');
    expect((await service.getHistory('u1', 'm1')).refNo).toBe('OGM-2026-000042');
  });
});

describe('adminCheckInsBulk — çok olayın check-in listesi', () => {
  const m1 = { id: 'm1', title: 'Marmaris', status: 'active' };
  const m2 = { id: 'm2', title: 'Fethiye', status: 'archived' };
  const checkIn = (over = {}) => ({
    id: 'c1',
    mission_id: 'm1',
    user_id: 'u1',
    method: 'qr',
    recorded_by: null,
    checked_in_at: new Date('2026-10-20T09:00:00Z'),
    ad: 'Ali',
    soyad: 'Yılmaz',
    phone: '+905551112233',
    stk_text: null,
    ...over,
  });

  it('her öğe tekil adminCheckIns yanıtının aynısı + missionId', async () => {
    const rows = [checkIn(), checkIn({ id: 'c2', user_id: 'u2', method: 'manual', recorded_by: 'Saha Amiri', stk_text: 'AKUT' })];
    mockState.tables.missions = { first: m1, rows: [m1] };
    mockState.tables['check_ins as ci'] = { rows };
    mockState.tables.check_ins = { first: { c: '2' }, grouped: [{ mission_id: 'm1', c: '2' }] };

    const single = await service.adminCheckIns('m1');
    const bulk = await service.adminCheckInsBulk(['m1']);

    expect(bulk).toEqual({ items: [{ missionId: 'm1', ...single }] });
    expect(single.trend).toEqual({ windowMinutes: 15, count: 2 });
  });

  it('istek sırasıyla döner, bilinmeyen id yer almaz; satırlar olayına, trend yoksa 0', async () => {
    mockState.tables.missions = { rows: [m1, m2] };
    mockState.tables['check_ins as ci'] = {
      rows: [checkIn({ id: 'c3', mission_id: 'm2', user_id: 'u3' }), checkIn(), checkIn({ id: 'c2', user_id: 'u2' })],
    };
    mockState.tables.check_ins = { grouped: [{ mission_id: 'm1', c: 2 }] };

    const { items } = await service.adminCheckInsBulk(['m2', 'mx', 'm1']);

    expect(items.map((i) => i.missionId)).toEqual(['m2', 'm1']);
    expect(items[0].mission).toEqual({ id: 'm2', title: 'Fethiye', status: 'archived' });
    expect(items[0].onSite).toBe(0); // arşivlenmiş olay: sayı 0, kayıtlar korunur
    expect(items[0].items.map((i) => i.userId)).toEqual(['u3']);
    expect(items[0].trend).toEqual({ windowMinutes: 15, count: 0 });
    expect(items[1].onSite).toBe(2);
    expect(items[1].items.map((i) => i.userId)).toEqual(['u1', 'u2']);
    expect(items[1].trend).toEqual({ windowMinutes: 15, count: 2 });
  });

  it('olay sayısından bağımsız 3 sorgu: missions, check-in listesi ve tek GROUP BY trend', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `m${i}`);
    mockState.tables.missions = { rows: ids.map((id) => ({ ...m1, id })) };
    const before = Date.now();

    await service.adminCheckInsBulk(ids);

    expect(mockState.chains).toHaveLength(3);
    const [missions] = chainsFor('missions');
    expect(callsNamed(missions, 'whereIn')).toEqual([['whereIn', 'id', ids]]);
    const [list] = chainsFor('check_ins as ci');
    expect(callsNamed(list, 'join')).toEqual([['join', 'users as u', 'u.id', 'ci.user_id']]);
    expect(callsNamed(list, 'whereIn')).toEqual([['whereIn', 'ci.mission_id', ids]]);
    expect(callsNamed(list, 'orderBy')).toEqual([['orderBy', 'ci.checked_in_at', 'desc']]);
    const [trend] = chainsFor('check_ins');
    expect(callsNamed(trend, 'whereIn')).toEqual([['whereIn', 'mission_id', ids]]);
    expect(callsNamed(trend, 'groupBy')).toEqual([['groupBy', 'mission_id']]);
    expect(callsNamed(trend, 'join')).toEqual([]);
    const [[, col, op, since]] = callsNamed(trend, 'where');
    expect([col, op]).toEqual(['checked_in_at', '>=']);
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 15 * 60 * 1000);
    expect(since.getTime()).toBeLessThanOrEqual(Date.now() - 15 * 60 * 1000);
  });

  it('hiçbir id bilinmiyorsa boş liste, check-in sorgusu atılmaz', async () => {
    mockState.tables.missions = { rows: [] };

    expect(await service.adminCheckInsBulk(['mx', 'my'])).toEqual({ items: [] });
    expect(mockState.chains.map((c) => c.table)).toEqual(['missions']);
  });
});
