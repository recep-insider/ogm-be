'use strict';

const { fromReq } = require('../../../shared/audit');
const adminAuthService = require('./adminAuth.service');

async function login(req, res) {
  const result = await adminAuthService.login({
    eposta: req.body.eposta,
    sifre: req.body.sifre,
    ...fromReq(req),
  });
  res.status(200).json(result);
}

async function refresh(req, res) {
  const result = await adminAuthService.refresh({
    refreshToken: req.body.refreshToken,
    ...fromReq(req),
  });
  res.status(200).json(result);
}

async function logout(req, res) {
  await adminAuthService.logout({
    refreshToken: req.body.refreshToken,
    ...fromReq(req),
  });
  res.status(204).end();
}

async function me(req, res) {
  // requireAdminAuth guarantees a bearer admin token → req.user.id is set.
  const admin = await adminAuthService.me(req.user.id);
  res.status(200).json({ admin });
}

module.exports = { login, refresh, logout, me };
