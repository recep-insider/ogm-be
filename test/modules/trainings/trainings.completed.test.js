'use strict';

// mobil §15 — "Alınan Eğitimler" listesi YOKLAMADAN gelir, elle işaretlenen bir
// "tamamladım" yoktur; teorik ve uygulamalı AYRI listelenir (biri diğerinin yerine geçmez).

const mockState = { theory: [], field: [], first: null };

jest.mock('../../../src/config/db', () => {
  const makeChain = (table) => {
    const c = {
      join: jest.fn(() => c),
      where: jest.fn(() => c),
      orderBy: jest.fn(() => c),
      first: jest.fn(async () => mockState.first),
      select: jest.fn(async () =>
        table === 'online_training_progress as p' ? mockState.theory : mockState.field,
      ),
    };
    return c;
  };
  const db = Object.assign(jest.fn((table) => makeChain(table)), { raw: jest.fn() });
  return { db };
});
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));
jest.mock('../../../src/shared/asset-url', () => ({
  assetUrl: (rel) => (rel ? `https://cdn.test/${rel}` : null),
}));

const { listCompleted, getCertificate } = require('../../../src/modules/trainings/trainings.service');

beforeEach(() => {
  mockState.theory = [
    {
      training_id: 'ot_1',
      title: 'Temel Yangın Eğitimi',
      duration_min: 90,
      delivery: 'yuzyuze',
      required: 1,
      completed_at: new Date('2026-06-01T09:00:00Z'),
      certificate_path: 'certs/ot_1.pdf',
    },
  ];
  mockState.field = [
    {
      training_id: 'st_1',
      title: 'Antalya Saha Eğitimi',
      location: 'Antalya',
      instructor_name: 'Mert Tan',
      grants_competency: 1,
      attendance_at: new Date('2026-07-01T09:00:00Z'),
      certificate_path: null,
    },
  ];
  mockState.first = null;
  jest.clearAllMocks();
});

describe('listCompleted', () => {
  it('teorik ve uygulamalı AYRI döner — tek "eğitim tamam" listesi yoktur', async () => {
    const result = await listCompleted('u1');

    expect(Object.keys(result)).toEqual(['teorik', 'uygulamali']);
    expect(result.teorik[0]).toMatchObject({ kind: 'teorik', required: true, delivery: 'yuzyuze' });
    expect(result.uygulamali[0]).toMatchObject({ kind: 'uygulamali', grantsCompetency: true });
  });

  it('teorik kayıt tamamlama kaydından, uygulamalı yoklamadan gelir', async () => {
    const result = await listCompleted('u1');

    expect(result.teorik[0].completedAt).toBe('2026-06-01T09:00:00.000Z');
    expect(result.uygulamali[0].completedAt).toBe('2026-07-01T09:00:00.000Z');
  });

  it('sertifika yalnızca üretilmişse URL taşır', async () => {
    const result = await listCompleted('u1');

    expect(result.teorik[0].certificateUrl).toBe('https://cdn.test/certs/ot_1.pdf');
    expect(result.uygulamali[0].certificateUrl).toBeNull();
  });
});

describe('getCertificate', () => {
  it('kayıt yoksa 404', async () => {
    await expect(getCertificate('u1', 'yok')).rejects.toMatchObject({ status: 404 });
  });

  it('kayıt var ama sertifika üretilmemişse certificate_not_issued', async () => {
    mockState.first = { training_id: 'ot_1', certificate_path: null };
    await expect(getCertificate('u1', 'ot_1')).rejects.toMatchObject({
      code: 'certificate_not_issued',
    });
  });

  it('sertifika varsa URL döner', async () => {
    mockState.first = { training_id: 'ot_1', certificate_path: 'certs/ot_1.pdf' };
    await expect(getCertificate('u1', 'ot_1')).resolves.toEqual({
      url: 'https://cdn.test/certs/ot_1.pdf',
    });
  });
});
