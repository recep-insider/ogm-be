'use strict';

// K29: aktif olay listesinde gönüllü yalnız çağrıldığı ve mesafe tercihinin kapsadığı
// olayları görür; diğerine katılım 403 mission_out_of_range.

jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async () => ({ engeller: [] })),
}));

const { db } = require('../../../src/config/db');
const service = require('../../../src/modules/missions/missions.service');

const mission = (id, lat, lng) => ({
  id, title: id, is_active: true, status: 'active', lat, lng, started_at: new Date('2026-11-01T10:00:00Z'),
});

beforeEach(() => {
  db.reset({
    missions: [
      mission('marmaris', 36.85, 28.27),
      mission('trabzon', 41.0, 39.72),
      mission('koordinatsiz', null, null),
      mission('cagrildigi', 41.0, 39.72),
    ],
    // Muğla'da yaşayan, 50 km tercihli gönüllü; Trabzon'daki bir olaya çağrılmış.
    notification_preferences: [{ user_id: 'u1', distance_km: 50, base_lat: 37.21, base_lng: 28.36 }],
    mission_participants: [{ id: 'p1', user_id: 'u1', mission_id: 'cagrildigi', status: 'cagrildi' }],
  });
});

describe('listActive', () => {
  it('mesafe tercihindeki ve çağrıldığı olayları döner, uzaktaki çağrılmadığı olayı dönmez', async () => {
    const ids = (await service.listActive('u1')).map((m) => m.id);
    expect(ids.sort()).toEqual(['cagrildigi', 'koordinatsiz', 'marmaris']);
  });

  it('baz konumu ya da mesafe tercihi olmayan gönüllü tüm aktif olayları görür', async () => {
    db.reset({ ...{ missions: db.rows('missions') }, notification_preferences: [], mission_participants: [] });
    expect(await service.listActive('u1')).toHaveLength(4);
  });
});

describe('respond — mesafe dışı katılım', () => {
  it('çağrılmadığı ve mesafe dışındaki olaya katılım 403 mission_out_of_range, kayıt yok', async () => {
    await expect(service.respond('u1', 'trabzon', 'yolda', {})).rejects.toMatchObject({ status: 403, code: 'mission_out_of_range' });
    expect(db.rows('mission_participants')).toHaveLength(1);
  });

  it('mesafe içindeki olaya katılır', async () => {
    await expect(service.respond('u1', 'marmaris', 'yolda', {})).resolves.toMatchObject({ userStatus: 'yolda' });
  });

  it('uzakta olsa da çağrıldığı olaya katılır', async () => {
    await expect(service.respond('u1', 'cagrildigi', 'yolda', {})).resolves.toMatchObject({ userStatus: 'yolda' });
  });
});
