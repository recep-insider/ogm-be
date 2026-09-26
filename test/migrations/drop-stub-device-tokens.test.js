'use strict';

const migration = require('../../migrations/20260927120000_drop_stub_device_tokens');

describe('migration — drop stub device tokens', () => {
  it('deletes only the devices whose token carries the stub- prefix', async () => {
    const calls = [];
    const query = {
      where: jest.fn((...args) => {
        calls.push(args);
        return query;
      }),
      del: jest.fn(async () => 3),
    };
    const knex = jest.fn(() => query);

    await migration.up(knex);

    expect(knex).toHaveBeenCalledWith('devices');
    expect(calls).toEqual([['fcm_token', 'like', 'stub-%']]);
    expect(query.del).toHaveBeenCalledTimes(1);
  });

  it('logs how many stub rows it removed, for the operator running the deploy', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const query = { where: jest.fn(() => query), del: jest.fn(async () => 7) };

    await migration.up(jest.fn(() => query));

    expect(log).toHaveBeenCalledWith(expect.stringContaining('7 stub'));
    log.mockRestore();
  });

  it('has a no-op down (the placeholder tokens are not worth restoring)', async () => {
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
