'use strict';

// db ve audit'i mock'la: setApplicationStatus yalnızca applications üzerinde
// where().orderBy().first() (oku) ve where().update() (yaz) zincirlerini kullanır.
const mockFirst = jest.fn();
const mockUpdate = jest.fn().mockResolvedValue(1);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../src/config/db', () => ({
  db: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    first: mockFirst,
    update: mockUpdate,
  })),
}));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: (...a) => mockWriteAudit(...a) }));

const { setApplicationStatus, APPLICATION_STATUSES } = require('../../../src/modules/admin/admin.service');

describe('admin.service — setApplicationStatus', () => {
  beforeEach(() => {
    mockFirst.mockReset();
    mockUpdate.mockClear();
    mockWriteAudit.mockClear();
  });

  test('geçersiz status validation_error fırlatır (DB sorgusu yapılmaz)', async () => {
    await expect(setApplicationStatus('u1', { status: 'banned' }, {})).rejects.toMatchObject({
      code: 'validation_error',
    });
    expect(mockFirst).not.toHaveBeenCalled();
  });

  test('başvuru yoksa application_not_found fırlatır', async () => {
    mockFirst.mockResolvedValue(undefined);
    await expect(setApplicationStatus('u1', { status: 'approved' }, {})).rejects.toMatchObject({
      code: 'application_not_found',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('en güncel başvuruyu approved yapar, audit yazar ve özet döner', async () => {
    mockFirst.mockResolvedValue({ id: 'app_1', status: 'pending', reviewer_note: null });

    const result = await setApplicationStatus('user-9', { status: 'approved', note: 'ok' }, {
      userId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest',
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const patch = mockUpdate.mock.calls[0][0];
    expect(patch.status).toBe('approved');
    expect(patch.reviewer_note).toBe('ok');
    expect(patch.reviewed_by).toBe('admin-1');
    expect(patch.reviewed_at).toBeInstanceOf(Date);

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
      action: 'admin.application.status',
      entity: 'application',
      entityId: 'app_1',
      payload: { targetUserId: 'user-9', from: 'pending', to: 'approved' },
    });

    expect(result).toMatchObject({ applicationId: 'app_1', userId: 'user-9', status: 'approved' });
    expect(typeof result.reviewedAt).toBe('string');
  });

  test('boş not mevcut reviewer_note\'u ezmez', async () => {
    mockFirst.mockResolvedValue({ id: 'app_2', status: 'pending', reviewer_note: 'önceki not' });

    await setApplicationStatus('u2', { status: 'approved', note: '' }, { userId: 'admin-1' });

    expect(mockUpdate.mock.calls[0][0].reviewer_note).toBe('önceki not');
  });

  test('APPLICATION_STATUSES enum migration ile aynı', () => {
    expect(APPLICATION_STATUSES).toEqual(['pending', 'approved', 'rejected', 'requires_revision']);
  });
});
