'use strict';

const service = require('./missions.service');

function audit(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

async function listActive(req, res) {
  res.status(200).json(await service.listActive(req.user.id));
}

async function getActive(req, res) {
  res.status(200).json(await service.getActive(req.user.id, req.params.id));
}

async function join(req, res) {
  res.status(200).json(await service.join(req.user.id, req.params.id, audit(req)));
}

async function scan(req, res) {
  const result = await service.scan(req.params.id, req.body, req.actor || {});
  res.status(200).json(result);
}

async function submitPhoto(req, res) {
  res.status(200).json(await service.submitPhoto(req.user.id, req.params.id, req.file, audit(req)));
}

async function listHistory(req, res) {
  res.status(200).json(await service.listHistory(req.user.id));
}

async function getHistory(req, res) {
  res.status(200).json(await service.getHistory(req.user.id, req.params.id));
}

module.exports = { listActive, getActive, join, scan, submitPhoto, listHistory, getHistory };
