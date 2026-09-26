'use strict';

// A key-file path that does not resolve must be named in the boot error — it is the part
// the operator has to fix, and the require() of it fails before firebase-admin is touched.

const MOCK_MISSING_PATH = '/nonexistent/ogm-secrets/firebase-sa-missing.json';

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn(), applicationDefault: jest.fn() },
  messaging: jest.fn(),
}), { virtual: true });
jest.mock('../../src/config/env', () => ({
  push: { provider: 'firebase' },
  firebase: { credentialsPath: MOCK_MISSING_PATH, projectId: 'ogm-test' },
}));
jest.mock('../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/config/db', () => ({ db: jest.fn() }));

const admin = require('firebase-admin');
const logger = require('../../src/config/logger');
const { verifyPushProvider } = require('../../src/shared/push-provider');

describe('push-provider — startup verification with a missing key file', () => {
  it('reports not ok when the credentials file cannot be loaded', () => {
    expect(verifyPushProvider()).toEqual({ provider: 'firebase', ok: false });
  });

  it('logs the configured credentialsPath alongside the load error', () => {
    logger.error.mockClear();

    verifyPushProvider();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('GİTMEYECEK'),
      expect.objectContaining({
        credentialsPath: MOCK_MISSING_PATH,
        error: expect.stringContaining('firebase-sa-missing.json'),
      }),
    );
  });

  it('fails on the key file before initialising firebase-admin', () => {
    admin.initializeApp.mockClear();

    verifyPushProvider();

    expect(admin.initializeApp).not.toHaveBeenCalled();
    expect(admin.credential.cert).not.toHaveBeenCalled();
  });
});
