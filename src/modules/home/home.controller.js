'use strict';

const homeService = require('./home.service');

async function feed(req, res) {
  const userId = req.user?.id || null;
  const result = await homeService.getFeed(userId);
  res.status(200).json(result);
}

module.exports = { feed };
