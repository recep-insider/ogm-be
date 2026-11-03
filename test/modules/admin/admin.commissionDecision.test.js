'use strict';

// K20 + BUG-021: eski sekmeden verilen komisyon kararı önceki kararı ezmez; aynı karar tekrar
// gelirse yeni kayıt ve SMS olmaz; aynı saniyedeki ikinci karar en güncel karar olarak okunur.

jest.mock('../../../src/config/db', () => ({ db: require('./panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('./panel-fakes').createFakeRedis() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/sms-provider', () => ({
  sendTransactional: jest.fn(async () => ({ sent: true, sentAt: new Date() })),
}));
jest.mock('../../../src/modules/users/readiness.service', () => ({
  getReadiness: jest.fn(async () => ({ kisiDurumu: 'basvuru', zincir: { eksikAdimlar: [] } })),
}));

const { db } = require('../../../src/config/db');
const { sendTransactional } = require('../../../src/shared/sms-provider');
const { setCommissionDecision } = require('../../../src/modules/admin/admin.service');

const USER = { id: 'u1', phone: '+905551112233', deleted_at: null };

beforeEach(() => {
  jest.clearAllMocks();
  db.reset({ users: [USER], commission_decisions: [], applications: [] });
});

describe('admin.service — setCommissionDecision', () => {
  it('ekrandaki karar güncelse karar yazılır ve SMS gider', async () => {
    const result = await setCommissionDecision('u1', { decision: 'approved', expectedDecision: 'pending' });

    expect(result).toMatchObject({ decision: 'approved', smsSent: true });
    expect(db.rows('commission_decisions')).toHaveLength(1);
    expect(sendTransactional).toHaveBeenCalledTimes(1);
  });

  it('karar arada başka bir görevlice verildiyse 409 decision_conflict; kayıt ve SMS yok', async () => {
    await setCommissionDecision('u1', { decision: 'approved', expectedDecision: null });
    sendTransactional.mockClear();

    await expect(setCommissionDecision('u1', { decision: 'rejected', expectedDecision: 'pending' }))
      .rejects.toMatchObject({ status: 409, code: 'decision_conflict', details: { currentDecision: 'approved' } });

    expect(db.rows('commission_decisions')).toHaveLength(1);
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it('aynı karar tekrar gelirse yeni kayıt ve SMS yok', async () => {
    await setCommissionDecision('u1', { decision: 'rejected' });
    sendTransactional.mockClear();

    const result = await setCommissionDecision('u1', { decision: 'rejected', expectedDecision: 'rejected' });

    expect(result).toMatchObject({ decision: 'rejected', unchanged: true, smsSent: false });
    expect(db.rows('commission_decisions')).toHaveLength(1);
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it('expectedDecision gönderilmezse (eski panel) değişen karar yazılır', async () => {
    await setCommissionDecision('u1', { decision: 'approved' });
    await setCommissionDecision('u1', { decision: 'rejected' });
    expect(db.rows('commission_decisions').map((r) => r.decision)).toEqual(['approved', 'rejected']);
  });

  it('aynı saniyede verilen ikinci karar en güncel karar olarak sıralanır', async () => {
    const sameSecond = new Date(Date.now() + 5000);
    db.reset({
      users: [USER],
      commission_decisions: [{ id: 'd0', user_id: 'u1', decision: 'approved', decided_at: sameSecond }],
      applications: [],
    });

    await setCommissionDecision('u1', { decision: 'rejected' });

    const [, second] = db.rows('commission_decisions');
    expect(second.decided_at.getTime()).toBeGreaterThan(sameSecond.getTime());
  });
});
