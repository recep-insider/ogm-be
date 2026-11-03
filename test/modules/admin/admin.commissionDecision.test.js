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

  it('saniye hassasiyetinde saklanan kararla aynı saniyedeki yeni karar bir saniye sonrasına yazılır', async () => {
    // decided_at TIMESTAMP(0): milisaniyeler saklanmaz, iki karar aynı saniyede eşitlenmemeli.
    jest.useFakeTimers({ now: new Date('2026-11-03T10:00:00.400Z'), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const stored = new Date('2026-11-03T10:00:00.000Z');
      db.reset({
        users: [USER],
        commission_decisions: [{ id: 'd0', user_id: 'u1', decision: 'approved', decided_at: stored }],
        applications: [],
      });

      await setCommissionDecision('u1', { decision: 'rejected' });

      const [, second] = db.rows('commission_decisions');
      expect(second.decided_at.toISOString()).toBe('2026-11-03T10:00:01.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('aynı kararın tekrarı (çift tıklama) eski expectedDecision ile gelse de çakışma değil, unchanged döner', async () => {
    await setCommissionDecision('u1', { decision: 'approved', expectedDecision: 'pending' });
    sendTransactional.mockClear();

    const retry = await setCommissionDecision('u1', { decision: 'approved', expectedDecision: 'pending' });

    expect(retry).toMatchObject({ decision: 'approved', unchanged: true, smsSent: false });
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it('silinme sürecindeki gönüllüye karar verilemez: 409 account_pending_deletion', async () => {
    db.reset({ users: [{ ...USER, deleted_at: new Date(), anonymized_at: null }], commission_decisions: [], applications: [] });

    await expect(setCommissionDecision('u1', { decision: 'approved' }))
      .rejects.toMatchObject({ status: 409, code: 'account_pending_deletion' });
    expect(db.rows('commission_decisions')).toHaveLength(0);
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it('anonimleşmiş hesap bulunamadı sayılır', async () => {
    db.reset({ users: [{ ...USER, deleted_at: new Date(), anonymized_at: new Date() }], commission_decisions: [], applications: [] });

    await expect(setCommissionDecision('u1', { decision: 'approved' }))
      .rejects.toMatchObject({ status: 404, code: 'user_not_found' });
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
