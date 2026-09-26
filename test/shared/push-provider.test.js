'use strict';

jest.mock('../../src/config/db', () => ({ db: jest.fn() }));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const logger = require('../../src/config/logger');
const { stringifyData, buildMulticast, deadTokens, verifyPushProvider } = require('../../src/shared/push-provider');

describe('push-provider — stringifyData', () => {
  it('drops undefined/null keys instead of sending "undefined"/"null" strings', () => {
    expect(stringifyData({ type: 'mission_call', missionId: undefined, reportId: null, n: 3, ok: false })).toEqual({
      type: 'mission_call',
      n: '3',
      ok: 'false',
    });
  });

  it('returns undefined when there is no data', () => {
    expect(stringifyData(undefined)).toBeUndefined();
  });
});

describe('push-provider — buildMulticast', () => {
  it.each(['acil', 'taskCalls', 'trainings', 'announcements'])(
    'maps topic %s to the Android channel of the same name',
    (topic) => {
      const msg = buildMulticast(['t1'], { topic, title: 'T', body: 'B', data: { a: 1 } });
      expect(msg).toEqual({
        tokens: ['t1'],
        notification: { title: 'T', body: 'B' },
        data: { a: '1' },
        android: ['acil', 'taskCalls'].includes(topic)
          ? { notification: { channelId: topic }, priority: 'high' }
          : { notification: { channelId: topic } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
    },
  );

  it('sends high priority for emergencies and mission calls only', () => {
    expect(buildMulticast(['t1'], { topic: 'acil', title: 'T', body: 'B' }).android.priority).toBe('high');
    expect(buildMulticast(['t1'], { topic: 'taskCalls', title: 'T', body: 'B' }).android.priority).toBe('high');
    expect(buildMulticast(['t1'], { topic: 'trainings', title: 'T', body: 'B' }).android).not.toHaveProperty('priority');
  });

  it('always asks iOS to play the default sound', () => {
    expect(buildMulticast(['t1'], { title: 'T', body: 'B' }).apns).toEqual({ payload: { aps: { sound: 'default' } } });
  });

  it('prefers an explicit channelId over the topic, which still drives opt-out', () => {
    const msg = buildMulticast(['t1'], {
      topic: 'taskCalls', channelId: 'fire-report-confirmed', title: 'T', body: 'B',
    });
    expect(msg.android).toEqual({ notification: { channelId: 'fire-report-confirmed' }, priority: 'high' });
  });

  it('leaves out the android block when neither a channelId nor a topic is given', () => {
    const msg = buildMulticast(['t1'], { title: 'T', body: 'B' });
    expect(msg).not.toHaveProperty('android');
  });
});

describe('push-provider — deadTokens', () => {
  it('picks tokens FCM reports as no longer registered', () => {
    const tokens = ['ok', 'gone', 'flaky'];
    const responses = [
      { success: true },
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/internal-error' } },
    ];
    expect(deadTokens(tokens, responses)).toEqual(['gone']);
  });

  it('treats invalid-argument as a malformed token when the payload reached other devices', () => {
    const responses = [
      { success: true },
      { success: false, error: { code: 'messaging/invalid-argument' } },
    ];
    expect(deadTokens(['ok', 'broken'], responses)).toEqual(['broken']);
  });

  it('keeps every token when invalid-argument hit all of them (a bad payload, not bad tokens)', () => {
    const responses = [
      { success: false, error: { code: 'messaging/invalid-argument' } },
      { success: false, error: { code: 'messaging/invalid-argument' } },
    ];
    expect(deadTokens(['a', 'b'], responses)).toEqual([]);
  });

  it('drops a not-registered token even when no token in the send succeeded', () => {
    const responses = [
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
    ];
    expect(deadTokens(['only-device'], responses)).toEqual(['only-device']);
  });

  it('keeps every token when the responses are missing', () => {
    expect(deadTokens(['a'], [])).toEqual([]);
  });

  it('treats a failed response without an error object as transient', () => {
    const responses = [{ success: true }, { success: false }];
    expect(deadTokens(['ok', 'no-error'], responses)).toEqual([]);
  });
});

describe('push-provider — verifyPushProvider (mock)', () => {
  it('reports the mock provider as ok without loading firebase-admin', () => {
    expect(verifyPushProvider()).toEqual({ provider: 'mock', ok: true });
  });

  it('logs at boot that the mock provider sends no real notifications', () => {
    logger.info.mockClear();
    verifyPushProvider();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('mock'));
  });
});
