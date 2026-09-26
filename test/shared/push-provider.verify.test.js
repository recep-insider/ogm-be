'use strict';

// A broken credential must surface once at boot, not silently on each emergency push.

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(() => {
    throw new Error("Cannot find module '/app/secrets/firebase-sa.json'");
  }),
  credential: { cert: jest.fn(), applicationDefault: jest.fn() },
  messaging: jest.fn(),
}), { virtual: true });
jest.mock('../../src/config/env', () => ({
  push: { provider: 'firebase' },
  firebase: { credentialsPath: '', projectId: 'ogm-test' },
}));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/config/db', () => ({ db: jest.fn() }));

const logger = require('../../src/config/logger');
const { verifyPushProvider } = require('../../src/shared/push-provider');

describe('push-provider — startup verification', () => {
  it('logs a loud error and reports not ok when firebase cannot start', () => {
    expect(verifyPushProvider()).toEqual({ provider: 'firebase', ok: false });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('GİTMEYECEK'),
      expect.objectContaining({ error: expect.stringContaining('firebase-sa.json') }),
    );
  });

  it('leaves credentialsPath out of the error when no key file is configured', () => {
    logger.error.mockClear();
    verifyPushProvider();
    expect(logger.error.mock.calls[0][1].credentialsPath).toBeUndefined();
  });
});
