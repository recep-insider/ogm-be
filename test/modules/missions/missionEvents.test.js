'use strict';

// Olay zaman çizelgesi denetim izi, bildirim kaydı ve check-in kayıtlarından türer.

const mockState = { tables: {} };

jest.mock('../../../src/config/db', () => {
  const column = (c) => c.split('.').pop();
  const makeChain = (name) => {
    const table = name.split(' ')[0];
    const preds = [];
    const rows = () => (mockState.tables[table] || []).filter((r) => preds.every((p) => p(r)));
    const c = {
      where: jest.fn((a, b) => {
        if (typeof a === 'object') preds.push((r) => Object.entries(a).every(([k, v]) => r[column(k)] === v));
        else preds.push((r) => r[column(a)] === b);
        return c;
      }),
      whereIn: jest.fn((col, values) => {
        preds.push((r) => values.includes(r[column(col)]));
        return c;
      }),
      leftJoin: jest.fn(() => c),
      orderBy: jest.fn(() => c),
      select: jest.fn(() => c),
      first: jest.fn(async () => rows()[0]),
      pluck: jest.fn(async (col) => rows().map((r) => r[col])),
      then: (resolve, reject) => Promise.resolve(rows()).then(resolve, reject),
    };
    return c;
  };
  return { db: jest.fn((name) => makeChain(name)) };
});
jest.mock('../../../src/modules/fireReports/fireReports.service', () => ({
  titlesFor: jest.fn(async (rows) => new Map(rows.map((r) => [r.id, `İhbar ${r.id}`]))),
}));

const service = require('../../../src/modules/missions/missionEvents.service');

const audit = (id, action, at, userId, payload, extra = {}) => ({
  id,
  action,
  entity: 'mission',
  entity_id: 'm1',
  user_id: userId,
  created_at: at,
  payload,
  ...extra,
});

const ayse = { kind: 'panel_user', id: 'p1', name: 'Ayşe' };
const mehmet = { kind: 'panel_user', id: 'p2', name: 'Mehmet' };

beforeEach(() => {
  mockState.tables = {
    missions: [
      { id: 'm1', status: 'archived', created_at: '2026-10-20T08:00:00Z', archived_at: '2026-10-20T15:00:00Z' },
    ],
    audit_log: [
      audit(1, 'missions.create', '2026-10-20T08:00:05Z', 'p1', { callVolunteers: true, linkedReports: 1 }),
      audit(2, 'missions.call', '2026-10-20T08:00:03Z', 'p1', { called: 12, outOfRange: 3, notReady: 5, withoutBaseLocation: 1 }),
      audit(3, 'fire_reports.link', '2026-10-20T09:00:00Z', 'p2', '{"reportIds":["r2","r3"]}'),
      audit(4, 'fire_reports.unlink', '2026-10-20T10:00:00Z', 'p2', { reportId: 'r3' }),
      audit(5, 'assembly_point.update', '2026-10-20T11:00:00Z', 'p1', {
        name: 'Stadyum',
        locationChanged: true,
        notified: { yolda: 2, sahada: 1, sms: 2 },
      }),
      audit(6, 'missions.archive', '2026-10-20T15:00:00Z', null, null),
      audit(7, 'missions.update', '2026-10-20T13:00:00Z', 'p1', { fields: ['title'] }),
      audit(8, 'notifications.send', '2026-10-20T12:00:00Z', 'p2', null, { entity: 'notification', entity_id: 'n1' }),
    ],
    notification_log: [
      {
        id: 'n1',
        mission_id: 'm1',
        category: 'acil',
        title: 'Tahliye',
        push_count: 20,
        sms_count: 18,
        target: '{"kind":"event","missionId":"m1","segments":["yolda","sahada"]}',
        sent_by: 'Mehmet',
        sent_at: '2026-10-20T12:00:00Z',
      },
    ],
    check_ins: [
      {
        id: 'c1',
        mission_id: 'm1',
        user_id: 'u1',
        ad: 'Ali',
        soyad: 'Kaya',
        deleted_at: null,
        checked_in_at: '2026-10-20T10:30:00Z',
        method: 'qr',
        recorded_by: 'Saha Amiri',
      },
    ],
    fire_reports: [
      { id: 'r1', mission_id: 'm1' },
      { id: 'r2', mission_id: 'm1' },
      { id: 'r3', mission_id: null },
    ],
    panel_users: [
      { id: 'p1', name: 'Ayşe' },
      { id: 'p2', name: 'Mehmet' },
    ],
  };
});

describe('missionEvents.listForMission', () => {
  it('yedi türü mevcut kayıtlardan kurar ve at artan sırada döner', async () => {
    const { data } = await service.listForMission('m1');

    expect(data).toEqual([
      {
        id: 'create-r1',
        type: 'report_linked',
        at: '2026-10-20T08:00:00.000Z',
        actor: ayse,
        detail: { reportId: 'r1', reportTitle: 'İhbar r1' },
      },
      {
        id: 'audit-2',
        type: 'mission_called',
        at: '2026-10-20T08:00:03.000Z',
        actor: ayse,
        detail: { recipients: 12, outOfRange: 3, notReady: 5, withoutBaseLocation: 1 },
      },
      {
        id: 'audit-3-r2',
        type: 'report_linked',
        at: '2026-10-20T09:00:00.000Z',
        actor: mehmet,
        detail: { reportId: 'r2', reportTitle: 'İhbar r2' },
      },
      {
        id: 'audit-3-r3',
        type: 'report_linked',
        at: '2026-10-20T09:00:00.000Z',
        actor: mehmet,
        detail: { reportId: 'r3', reportTitle: 'İhbar r3' },
      },
      {
        id: 'audit-4',
        type: 'report_unlinked',
        at: '2026-10-20T10:00:00.000Z',
        actor: mehmet,
        detail: { reportId: 'r3', reportTitle: 'İhbar r3' },
      },
      {
        id: 'checkin-c1',
        type: 'first_checkin',
        at: '2026-10-20T10:30:00.000Z',
        actor: { kind: 'volunteer', id: 'u1', name: 'Ali Kaya' },
        detail: { volunteer: { id: 'u1', name: 'Ali Kaya' }, method: 'qr', recordedBy: 'Saha Amiri' },
      },
      {
        id: 'audit-5',
        type: 'assembly_point_changed',
        at: '2026-10-20T11:00:00.000Z',
        actor: ayse,
        detail: { name: 'Stadyum', locationChanged: true, notified: { yolda: 2, sahada: 1, sms: 2 } },
      },
      {
        id: 'notification-n1',
        type: 'notification_sent',
        at: '2026-10-20T12:00:00.000Z',
        actor: mehmet,
        detail: {
          notificationId: 'n1',
          category: 'acil',
          title: 'Tahliye',
          recipients: 20,
          smsCount: 18,
          segments: ['yolda', 'sahada'],
        },
      },
      {
        id: 'audit-6',
        type: 'mission_closed',
        at: '2026-10-20T15:00:00.000Z',
        actor: { kind: 'system', id: null, name: null },
        detail: { archivedAt: '2026-10-20T15:00:00.000Z' },
      },
    ]);
  });

  it('olay yoksa 404 mission_not_found', async () => {
    await expect(service.listForMission('yok')).rejects.toMatchObject({ status: 404, code: 'mission_not_found' });
  });

  it('arşiv kaydı olmayan eski arşivlenmiş olay archived_at anında, aktörsüz kapanır', async () => {
    mockState.tables.audit_log = [];

    const { data } = await service.listForMission('m1');

    expect(data.find((e) => e.type === 'mission_closed')).toEqual({
      id: 'archive-m1',
      type: 'mission_closed',
      at: '2026-10-20T15:00:00.000Z',
      actor: null,
      detail: { archivedAt: '2026-10-20T15:00:00.000Z' },
    });
    // Oluşturma kaydı da yoksa oluşturulurken bağlanan ihbarın aktörü bilinmez.
    expect(data.filter((e) => e.type === 'report_linked').map((e) => [e.detail.reportId, e.actor])).toEqual([
      ['r1', null],
      ['r2', null],
    ]);
  });

  it('silinmiş gönüllünün adı dönmez', async () => {
    mockState.tables.check_ins[0].deleted_at = '2026-10-21T00:00:00Z';

    const { data } = await service.listForMission('m1');

    const checkIn = data.find((e) => e.type === 'first_checkin');
    expect(checkIn.actor).toEqual({ kind: 'volunteer', id: null, name: 'Silinmiş gönüllü' });
    expect(checkIn.detail.volunteer).toEqual({ id: null, name: 'Silinmiş gönüllü' });
  });

  it('gönderim denetim kaydı yoksa bildirimin göndereni kayıttaki addır', async () => {
    mockState.tables.audit_log = mockState.tables.audit_log.filter((a) => a.action !== 'notifications.send');

    const { data } = await service.listForMission('m1');

    expect(data.find((e) => e.type === 'notification_sent').actor).toEqual({ kind: 'panel_user', id: null, name: 'Mehmet' });
  });

  it('check-in, bildirim ve ihbar yoksa yalnız denetim olayları döner', async () => {
    mockState.tables = {
      missions: [{ id: 'm1', status: 'active', created_at: '2026-10-20T08:00:00Z', archived_at: null }],
      audit_log: [audit(2, 'missions.call', '2026-10-20T08:00:03Z', 'p1', { called: 0 })],
      panel_users: [{ id: 'p1', name: 'Ayşe' }],
    };

    const { data } = await service.listForMission('m1');

    expect(data).toEqual([
      {
        id: 'audit-2',
        type: 'mission_called',
        at: '2026-10-20T08:00:03.000Z',
        actor: ayse,
        detail: { recipients: 0, outOfRange: 0, notReady: 0, withoutBaseLocation: 0 },
      },
    ]);
  });
});
