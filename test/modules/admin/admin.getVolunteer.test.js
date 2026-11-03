'use strict';

// K3: silinme sürecindeki hesap açılır, anonimleşmiş hesap artık kişi değildir.

jest.mock('../../../src/config/db', () => ({ db: require('./panel-fakes').createFakeDb() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async () => ({ kisiDurumu: 'pasif', zincir: { eksikAdimlar: [] } })),
  kkdSet: jest.fn(async () => null),
}));

const { db } = require('../../../src/config/db');
const { writeAudit } = require('../../../src/shared/audit');
const { getVolunteer } = require('../../../src/modules/admin/admin.service');

beforeEach(() => jest.clearAllMocks());

describe('admin.service — getVolunteer anonimleşmiş hesap', () => {
  it('anonymized_at dolu hesap 404 user_not_found; PII görüntüleme izi yazılmaz', async () => {
    db.reset({
      users: [{ id: 'u1', deleted_at: new Date('2026-09-01'), anonymized_at: new Date('2026-10-01') }],
    });

    await expect(getVolunteer('u1')).rejects.toMatchObject({ status: 404, code: 'user_not_found' });
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
