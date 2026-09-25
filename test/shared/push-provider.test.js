'use strict';

jest.mock('../../src/config/db', () => ({ db: jest.fn() }));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { stringifyData, buildMulticast } = require('../../src/shared/push-provider');

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
        android: { notification: { channelId: topic } },
      });
    },
  );

  it('prefers an explicit channelId over the topic, which still drives opt-out', () => {
    const msg = buildMulticast(['t1'], {
      topic: 'taskCalls', channelId: 'fire-report-confirmed', title: 'T', body: 'B',
    });
    expect(msg.android).toEqual({ notification: { channelId: 'fire-report-confirmed' } });
  });
});
