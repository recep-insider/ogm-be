'use strict';

const phoneService = require('./phone.service');

async function sendOtp(req, res) {
  const result = await phoneService.sendOtpFlow({
    phone: req.body.phone,
    ip: req.ip,
  });
  res.status(200).json(result);
}

async function verifyOtp(req, res) {
  const result = await phoneService.verifyOtpFlow({
    sessionId: req.body.sessionId,
    code: req.body.code,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(200).json(result);
}

async function resendOtp(req, res) {
  const result = await phoneService.resendOtpFlow({
    sessionId: req.body.sessionId,
    ip: req.ip,
  });
  res.status(200).json(result);
}

module.exports = { sendOtp, verifyOtp, resendOtp };
