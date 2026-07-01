'use strict';

// fireReports.service'in dış bağımlılıklarını izole et (redis/env/logger/push import'ları).
jest.mock('../../../src/config/db', () => ({ db: Object.assign(jest.fn(), { raw: jest.fn() }) }));
jest.mock('../../../src/config/redis', () => ({ redis: { incr: jest.fn(), expire: jest.fn() } }));
jest.mock('../../../src/config/env', () => ({
  geo: {},
  upload: { dir: '/tmp' },
  api: { baseUrl: 'https://api.test' },
}));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({
  assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null),
}));

const { mapAdminReport } = require('../../../src/modules/fireReports/fireReports.service');

const baseRow = {
  id: 'fr1',
  location_name: 'Marmaris',
  region_label: 'Muğla / Marmaris',
  status: 'reviewing',
  created_at: new Date('2026-06-09T14:23:00Z'),
  latitude: '36.8500000',
  longitude: '28.2700000',
  needs: '["Su/Kumanya"]',
  description: 'Duman görüldü',
  anonymous: 0,
  photo_paths: '["reports/a.jpg","reports/b.jpg"]',
  user_id: 'u1',
  reporter_ad: 'Ahmet',
  reporter_soyad: 'Yılmaz',
  reporter_phone: '+905321112233',
  ip: '1.2.3.4',
};

describe('fireReports.service — mapAdminReport', () => {
  test('liste görünümü: mapReport alanları + medya + ihbarcı; ip YOK', () => {
    const dto = mapAdminReport(baseRow);

    expect(dto).toMatchObject({
      id: 'fr1',
      locationName: 'Marmaris',
      status: 'reviewing',
      submittedAt: '2026-06-09T14:23:00.000Z',
      coordinates: { lat: 36.85, lng: 28.27 },
      needs: ['Su/Kumanya'],
      description: 'Duman görüldü',
      anonymous: false,
      photoUrls: ['https://cdn.test/reports/a.jpg', 'https://cdn.test/reports/b.jpg'],
      reporter: { userId: 'u1', ad: 'Ahmet', soyad: 'Yılmaz', phone: '+905321112233' },
    });
    expect(dto).not.toHaveProperty('ip');
  });

  test('anonim ihbarda reporter null döner (kullanıcı bağlı olsa bile)', () => {
    const dto = mapAdminReport({ ...baseRow, anonymous: 1 });
    expect(dto.anonymous).toBe(true);
    expect(dto.reporter).toBeNull();
  });

  test('detay görünümü includeIp ile ip içerir', () => {
    const dto = mapAdminReport(baseRow, { includeIp: true });
    expect(dto.ip).toBe('1.2.3.4');
  });

  test('bozuk photo_paths JSON boş listeye düşer', () => {
    const dto = mapAdminReport({ ...baseRow, photo_paths: '{{bozuk' });
    expect(dto.photoUrls).toEqual([]);
  });
});
