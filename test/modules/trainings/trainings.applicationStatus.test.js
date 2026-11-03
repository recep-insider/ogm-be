'use strict';

// K27: reddedilen ya da eğitimden çıkarılan gönüllüye bildirim gider (yalnız ret kesinleşince).

jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn(async () => ({ sent: 1 })) }));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { db } = require('../../../src/config/db');
const { sendPushToUser } = require('../../../src/shared/push-provider');
const { adminSetSahaApplicationStatus } = require('../../../src/modules/trainings/trainings.service');

beforeEach(() => {
  jest.clearAllMocks();
  db.reset({
    saha_trainings: [{ id: 's1', title: 'Yangın Hattı Eğitimi' }],
    saha_training_applications: [{ id: 'a1', user_id: 'u1', training_id: 's1', status: 'approved' }],
  });
});

describe('adminSetSahaApplicationStatus — ret bildirimi', () => {
  it('ret yazılınca gönüllüye eğitim adıyla bildirim gider', async () => {
    await adminSetSahaApplicationStatus('a1', { status: 'rejected' });

    expect(db.rows('saha_training_applications')[0].status).toBe('rejected');
    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.objectContaining({
      topic: 'trainings',
      body: '"Yangın Hattı Eğitimi" eğitimine katılımınız onaylanmadı.',
      data: { type: 'saha_application_rejected', trainingId: 's1' },
    }));
  });

  it('zaten reddedilmiş başvuruya ikinci bildirim gitmez; onayda bildirim yok', async () => {
    db.reset({ saha_training_applications: [{ id: 'a1', user_id: 'u1', training_id: 's1', status: 'rejected' }] });
    await adminSetSahaApplicationStatus('a1', { status: 'rejected' });
    await adminSetSahaApplicationStatus('a1', { status: 'approved' });
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('aynı anda gelen iki ret tek bildirim gönderir', async () => {
    await Promise.all([
      adminSetSahaApplicationStatus('a1', { status: 'rejected' }),
      adminSetSahaApplicationStatus('a1', { status: 'rejected' }),
    ]);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  it('bildirim gönderilemese de durum kaydedilir', async () => {
    sendPushToUser.mockRejectedValueOnce(new Error('fcm down'));
    await expect(adminSetSahaApplicationStatus('a1', { status: 'rejected' })).resolves.toEqual({ applicationId: 'a1', status: 'rejected' });
  });
});
