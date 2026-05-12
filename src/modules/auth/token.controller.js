'use strict';

const tokenService = require('./token.service');

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

module.exports = { refresh, logout };
