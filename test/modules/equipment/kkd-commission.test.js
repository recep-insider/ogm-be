'use strict';

jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({ assetUrl: (rel) => rel }));

const { db } = require('../../../src/config/db');
const { deliverKkdSet } = require('../../../src/modules/equipment/equipment.service');
const { adminSaveAttendance } = require('../../../src/modules/trainings/trainings.service');
const { KKD_ITEM_KEYS } = require('../../../src/shared/kkd');

const user = (id) => ({ id, deleted_at: null });
const decision = (userId, value, decidedAt) => ({
  id: `${userId}-${decidedAt}`,
  user_id: userId,
  decision: value,
  decided_at: new Date(decidedAt),
});
const application = (userId) => ({
  id: `app-${userId}`,
  training_id: 'st1',
  user_id: userId,
  attendance: 'kayitli',
  kkd_delivered: false,
});

describe('deliverKkdSet — komisyon onayı', () => {
  test('en güncel karar onay → set teslim edilir', async () => {
    db.reset({
      users: [user('u1')],
      commission_decisions: [decision('u1', 'rejected', '2026-01-01'), decision('u1', 'approved', '2026-02-01')],
      equipment: [],
    });

    const result = await deliverKkdSet('u1');

    expect(result.delivered).toEqual(KKD_ITEM_KEYS);
    expect(db.rows('equipment')).toHaveLength(KKD_ITEM_KEYS.length);
  });

  test.each([
    ['karar yok', []],
    ['en güncel karar ret', [decision('u1', 'approved', '2026-01-01'), decision('u1', 'rejected', '2026-02-01')]],
  ])('%s → 409 commission_not_approved, zimmet yazılmaz', async (_label, decisions) => {
    db.reset({ users: [user('u1')], commission_decisions: decisions, equipment: [] });

    await expect(deliverKkdSet('u1')).rejects.toMatchObject({
      status: 409,
      code: 'commission_not_approved',
      details: { userIds: ['u1'] },
    });
    expect(db.rows('equipment')).toHaveLength(0);
  });
});

describe('adminSaveAttendance — KKD teslimi komisyon onayı', () => {
  beforeEach(() => {
    db.reset({
      saha_trainings: [{ id: 'st1', grants_competency: true }],
      saha_training_applications: [application('u1'), application('u2'), application('u3')],
      users: [user('u1'), user('u2'), user('u3')],
      commission_decisions: [decision('u1', 'approved', '2026-01-01'), decision('u2', 'rejected', '2026-01-01')],
      equipment: [],
    });
  });

  test('onaysız bir gönüllü varsa tüm istek 409, hiçbir satır yazılmaz', async () => {
    await expect(
      adminSaveAttendance('st1', {
        entries: [
          { userId: 'u1', attended: true, kkdDelivered: true },
          { userId: 'u2', attended: true, kkdDelivered: true },
          { userId: 'u3', attended: true, kkdDelivered: true },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, code: 'commission_not_approved', details: { userIds: ['u2', 'u3'] } });

    expect(db.rows('saha_training_applications').every((a) => a.attendance === 'kayitli')).toBe(true);
    expect(db.rows('equipment')).toHaveLength(0);
  });

  test('ikinci teslim yarıda düşerse ilk gönüllünün yoklaması ve zimmeti de geri alınır', async () => {
    db.reset({
      saha_trainings: [{ id: 'st1', grants_competency: true }],
      saha_training_applications: [application('u1'), application('u2')],
      users: [user('u1'), { id: 'u2', deleted_at: new Date('2026-03-01') }],
      commission_decisions: [decision('u1', 'approved', '2026-01-01'), decision('u2', 'approved', '2026-01-01')],
      equipment: [],
    });

    await expect(
      adminSaveAttendance('st1', {
        entries: [
          { userId: 'u1', attended: true, kkdDelivered: true },
          { userId: 'u2', attended: true, kkdDelivered: true },
        ],
      }),
    ).rejects.toMatchObject({ status: 404, code: 'user_not_found' });

    expect(db.rows('saha_training_applications').every((a) => a.attendance === 'kayitli')).toBe(true);
    expect(db.rows('equipment')).toHaveLength(0);
  });

  test('KKD işaretlenmeyen onaysız gönüllü yoklamayı engellemez', async () => {
    const result = await adminSaveAttendance('st1', {
      entries: [
        { userId: 'u1', attended: true, kkdDelivered: true },
        { userId: 'u2', attended: true },
      ],
    });

    expect(result.items.map((i) => i.kkdDelivered)).toEqual([true, false]);
    expect(db.rows('equipment').every((e) => e.user_id === 'u1')).toBe(true);
    expect(db.rows('equipment')).toHaveLength(KKD_ITEM_KEYS.length);
  });
});
