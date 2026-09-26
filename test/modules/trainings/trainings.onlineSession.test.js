'use strict';

// The face-to-face session of a theory training (startsAt, location, instructor) is
// stored in session_starts_at / session_location / session_instructor. Create writes
// them, update clears them on null/'' and leaves them alone when the field is absent.

const mockWrites = { inserts: [], updates: [] };

jest.mock('../../../src/config/db', () => {
  const makeChain = () => {
    const chain = {};
    for (const method of ['where', 'select', 'max']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.first = jest.fn(async () => ({ id: 'o1', m: 3 }));
    chain.insert = jest.fn(async (row) => {
      mockWrites.inserts.push(row);
      return [1];
    });
    chain.update = jest.fn(async (row) => {
      mockWrites.updates.push(row);
      return 1;
    });
    return chain;
  };
  const dbFn = jest.fn(() => makeChain());
  dbFn.raw = jest.fn((sql) => ({ __raw: sql }));
  return { db: dbFn };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({ assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null) }));
jest.mock('../../../src/modules/equipment/equipment.service', () => ({ deliverKkdSet: jest.fn() }));

const { adminCreateOnline, adminUpdateOnline } = require('../../../src/modules/trainings/trainings.service');

const SESSION_COLUMNS = ['session_starts_at', 'session_location', 'session_instructor'];

beforeEach(() => {
  mockWrites.inserts = [];
  mockWrites.updates = [];
});

describe('adminCreateOnline session columns', () => {
  it('writes session_starts_at, session_location and session_instructor', async () => {
    await adminCreateOnline({
      title: 'Yüz Yüze Temel',
      durationMin: 60,
      delivery: 'yuzyuze',
      startsAt: '2026-10-01T07:00:00.000Z',
      location: 'Salon A',
      instructor: 'Ayşe Demir',
    });

    const [row] = mockWrites.inserts;
    expect(row.session_starts_at).toBeInstanceOf(Date);
    expect(row.session_starts_at.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(row.session_location).toBe('Salon A');
    expect(row.session_instructor).toBe('Ayşe Demir');
  });
});

describe('adminUpdateOnline session columns', () => {
  it('clears the session columns when the fields are null or empty', async () => {
    await adminUpdateOnline('o1', { startsAt: null, location: '', instructor: null });

    const [row] = mockWrites.updates;
    expect(row).toMatchObject({
      session_starts_at: null,
      session_location: null,
      session_instructor: null,
    });
  });

  it('leaves the session columns untouched when the fields are absent', async () => {
    await adminUpdateOnline('o1', { title: 'Yeni Başlık' });

    const [row] = mockWrites.updates;
    expect(row.title).toBe('Yeni Başlık');
    for (const column of SESSION_COLUMNS) {
      expect(row).not.toHaveProperty(column);
    }
  });
});
