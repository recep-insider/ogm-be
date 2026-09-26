'use strict';

// With FIREBASE_PROJECT_ID empty, ADC infers the project; the boot log must not report an empty id.

jest.mock(
  'firebase-admin',
  () => ({
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(), applicationDefault: jest.fn(() => 'adc') },
    messaging: jest.fn(() => ({ sendEachForMulticast: jest.fn() })),
  }),
  { virtual: true },
);
jest.mock('../../src/config/env', () => ({
  push: { provider: 'firebase' },
  firebase: { credentialsPath: '', projectId: '' },
}));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/config/db', () => ({ db: jest.fn() }));

const logger = require('../../src/config/logger');
const { verifyPushProvider } = require('../../src/shared/push-provider');

describe('push-provider — startup verification without a project id', () => {
  it('reports firebase as ok when ADC supplies the project', () => {
    expect(verifyPushProvider()).toEqual({ provider: 'firebase', ok: true });
  });

  it('omits projectId from the success log instead of logging an empty string', () => {
    logger.info.mockClear();
    verifyPushProvider();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][1].projectId).toBeUndefined();
  });
});
