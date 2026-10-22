'use strict';

// Toplanma noktası değişikliği yolda/sahada katılımcılara zorunlu push + SMS gönderir.
// Silinen (KVKK) hesabın katılımcı satırı kalır; ona push ya da SMS gitmemeli.

const mockState = { participants: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const nullCols = [];
    const c = {
      join: jest.fn(() => c),
      where: jest.fn(() => c),
      whereIn: jest.fn(() => c),
      whereNull: jest.fn((col) => {
        nullCols.push(col);
        return c;
      }),
      first: jest.fn(async () => (table === 'missions' ? { title: 'Marmaris Yangını' } : undefined)),
      select: jest.fn(async () => mockState.participants
        .filter((p) => !(nullCols.includes('u.deleted_at') && p.deleted_at))
        .map(({ deleted_at: _deletedAt, ...row }) => row)),
    };
    return c;
  };
  return { db: Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() }) };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/push-provider', () => ({ sendPushToUser: jest.fn(async () => ({ sent: 1 })) }));
jest.mock('../../../src/shared/sms-provider', () => ({ sendSms: jest.fn(async () => ({})) }));

const { sendPushToUser } = require('../../../src/shared/push-provider');
const { sendSms } = require('../../../src/shared/sms-provider');
const { notifyLocationChange } = require('../../../src/modules/missions/assemblyPoints.service');

const POINT = { name: 'Stadyum', coordinates: { lat: 36.9, lng: 28.3 } };

beforeEach(() => jest.clearAllMocks());

describe('notifyLocationChange — silinmiş hesap', () => {
  it('silinmiş katılımcıya push ve SMS göndermez, sayaca katmaz', async () => {
    mockState.participants = [
      { status: 'yolda', user_id: 'u1', phone: '+905321112233', deleted_at: null },
      { status: 'yolda', user_id: 'u2', phone: '+905329998877', deleted_at: new Date('2026-10-01') },
    ];

    const summary = await notifyLocationChange('m1', POINT);

    expect(summary).toEqual({ yolda: 1, sahada: 0, sms: 1 });
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith('u1', expect.anything());
    expect(sendSms).toHaveBeenCalledWith('+905321112233', expect.any(String));
    expect(sendSms).not.toHaveBeenCalledWith('+905329998877', expect.any(String));
  });
});
