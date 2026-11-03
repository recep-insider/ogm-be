'use strict';

// BUG-041: KVKK rıza kaydı yayımlanan metin sürümüyle doğrulanır.

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));
jest.mock('../../../src/config/db', () => ({ db: require('../admin/panel-fakes').createFakeDb() }));
jest.mock('../../../src/config/redis', () => ({ redis: require('../admin/panel-fakes').createFakeRedis() }));
jest.mock('../../../src/shared/audit', () => ({ writeAudit: jest.fn() }));

const { db } = require('../../../src/config/db');
const { recordConsent } = require('../../../src/modules/users/users.service');
const { DOCUMENTS, publishedVersion } = require('../../../src/shared/legal-documents');

beforeEach(() => db.reset({ consents: [] }));

describe('recordConsent', () => {
  it.each([['kvkk', 'kvkk'], ['aydinlatma', 'aydinlatma-metni'], ['acik_riza', 'acik-riza']])(
    '%s onayı yayımlanan %s sürümüyle kaydedilir',
    async (document, legalKey) => {
      await recordConsent('u1', { document, version: DOCUMENTS[legalKey].version });
      expect(db.rows('consents')).toEqual([expect.objectContaining({ document, version: DOCUMENTS[legalKey].version })]);
    },
  );

  it('yayımlanan sürümle eşleşmeyen sürüm (mobilin sabit v1\'i) 400 consent_version_mismatch, kayıt yok', async () => {
    await expect(recordConsent('u1', { document: 'kvkk', version: 'v1' })).rejects.toMatchObject({
      status: 400,
      code: 'consent_version_mismatch',
      details: { expectedVersion: publishedVersion('kvkk') },
    });
    expect(db.rows('consents')).toHaveLength(0);
  });
});
