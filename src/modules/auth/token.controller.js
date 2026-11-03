'use strict';

const tokenService = require('./token.service');
const phoneService = require('./phone.service');

async function refresh(req, res) {
  const result = await tokenService.refresh({
    refreshToken: req.body.refreshToken,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}

async function logout(req, res) {
  await tokenService.logout({
    refreshToken: req.body.refreshToken,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(204).end();
}

async function restore(req, res) {
  const result = await phoneService.restoreFlow({
    restoreToken: req.body.restoreToken,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}

module.exports = { refresh, logout, restore };
