'use strict';

const calls = [];

jest.mock('../src/app', () => ({
  listen: jest.fn(() => {
    calls.push('listen');
    return {};
  }),
}));
jest.mock('../src/config/env', () => ({
  port: 0,
  nodeEnv: 'test',
  db: { host: 'db', name: 'ogm' },
  redis: { host: 'redis' },
}));
jest.mock('../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/config/db', () => ({
  pingDb: jest.fn(async () => {}),
  closeDb: jest.fn(async () => {}),
}));
jest.mock('../src/config/redis', () => ({
  connectRedis: jest.fn(async () => {}),
  pingRedis: jest.fn(async () => {}),
  closeRedis: jest.fn(async () => {}),
}));
jest.mock('../src/shared/push-provider', () => ({
  verifyPushProvider: jest.fn(() => {
    calls.push('verifyPushProvider');
    return { provider: 'mock', ok: true };
  }),
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('server — bootstrap', () => {
  let onSpy;

  beforeEach(() => {
    calls.length = 0;
    // Keep the bootstrap from installing real signal/exception handlers on the test process.
    onSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    onSpy.mockRestore();
  });

  it('verifies the push provider exactly once, before the HTTP server starts listening', async () => {
    const { verifyPushProvider } = require('../src/shared/push-provider');
    require('../src/server');
    await flush();

    expect(verifyPushProvider).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['verifyPushProvider', 'listen']);
  });

  it('keeps serving the API when the push provider could not start', async () => {
    const { verifyPushProvider } = require('../src/shared/push-provider');
    verifyPushProvider.mockImplementationOnce(() => {
      calls.push('verifyPushProvider');
      return { provider: 'firebase', ok: false };
    });
    jest.isolateModules(() => {
      require('../src/server');
    });
    await flush();

    expect(calls).toEqual(['verifyPushProvider', 'listen']);
  });
});
