'use strict';

const referenceService = require('./reference.service');

async function get(req, res) {
  const result = await referenceService.getCategory(req.params.category);
  res.status(200).json(result);
}

module.exports = { get };
