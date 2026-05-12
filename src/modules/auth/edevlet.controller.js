'use strict';

const edevletService = require('./edevlet.service');
const env = require('../../config/env');

async function initiate(req, res) {
  const result = await edevletService.initiate({
    callbackScheme: req.body.callbackScheme,
  });
  res.status(200).json(result);
}

async function callback(req, res) {
  const result = await edevletService.callback({
    sessionId: req.body.sessionId,
    code: req.body.code,
    state: req.body.state,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}

async function mockCallback(req, res) {
  if (!env.edevlet.mockMode) {
    return res.status(404).send('Mock devre dışı');
  }
  const { sessionId, state } = req.query;
  res.status(200).json({
    info:
      'Bu sahte bir e-Devlet onay sayfasıdır. Mobil uygulama bu URL\'i in-app browser\'da açar; ' +
      'dev ortamında doğrudan callback POST\'u çağırarak kullanıcı oluşturabilirsiniz.',
    sessionId,
    state,
    samplePost: {
      url: `${env.api.baseUrl}/v1/auth/edevlet/callback`,
      body: { sessionId, code: 'mock-code-' + sessionId, state },
    },
    kimlik: edevletService.buildMockKimlik(),
  });
}

module.exports = { initiate, callback, mockCallback };
