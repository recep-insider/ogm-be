'use strict';

const service = require('./notifications.service');

async function register(req, res) {
  const result = await service.registerDevice(req.user.id, req.body);
  res.status(201).json(result);
}

async function remove(req, res) {
  await service.deleteDevice(req.user.id, req.params.tokenId);
  res.status(204).end();
}

module.exports = { register, remove };
