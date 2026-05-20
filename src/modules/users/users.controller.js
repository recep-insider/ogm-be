'use strict';

const usersService = require('./users.service');
const phoneChangeService = require('./phone-change.service');

function audit(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

async function getMe(req, res) {
  const profile = await usersService.getMe(req.user.id);
  res.status(200).json(profile);
}

async function patchMe(req, res) {
  const profile = await usersService.patchMe(req.user.id, req.body, audit(req));
  res.status(200).json(profile);
}

async function updateAcil(req, res) {
  const profile = await usersService.updateAcil(req.user.id, req.body, audit(req));
  res.status(200).json(profile);
}

async function setAvatar(req, res) {
  const result = await usersService.setAvatar(req.user.id, req.file, audit(req));
  res.status(200).json(result);
}

async function recordConsent(req, res) {
  const result = await usersService.recordConsent(req.user.id, {
    document: req.body.document,
    version: req.body.version,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(201).json(result);
}

async function dataExport(req, res) {
  const result = await usersService.dataExport(req.user.id, audit(req));
  res.setHeader('Content-Disposition', 'attachment; filename="ogm-gonullu-data-export.json"');
  res.status(200).json(result);
}

async function softDelete(req, res) {
  const result = await usersService.softDelete(req.user.id, audit(req));
  res.status(200).json(result);
}

async function phoneChangeInit(req, res) {
  const result = await phoneChangeService.init({
    userId: req.user.id,
    newPhone: req.body.phone,
    ...audit(req),
  });
  res.status(200).json(result);
}

async function phoneChangeCommit(req, res) {
  const result = await phoneChangeService.commit({
    userId: req.user.id,
    sessionId: req.body.sessionId,
    code: req.body.code,
    ...audit(req),
  });
  res.status(200).json(result);
}

module.exports = {
  getMe,
  patchMe,
  updateAcil,
  setAvatar,
  recordConsent,
  dataExport,
  softDelete,
  phoneChangeInit,
  phoneChangeCommit,
};
