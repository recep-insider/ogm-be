'use strict';

const { Router } = require('express');
const asyncHandler = require('../../shared/async-handler');
const { optionalAuth } = require('../../middlewares/auth');
const controller = require('./home.controller');

const router = Router();

/**
 * @openapi
 * /home/feed:
 *   get:
 *     tags: [Home]
 *     summary: Ana sayfa için tüm bölümleri tek istekte döner
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     responses:
 *       200:
 *         description: Feed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     ad: { type: string, nullable: true }
 *                     avatarUrl: { type: string, format: uri, nullable: true }
 *                 emergencyAction: { $ref: '#/components/schemas/EmergencyAction' }
 *                 activeTasks: { $ref: '#/components/schemas/ActiveTasks' }
 *                 trainings:
 *                   type: object
 *                   properties:
 *                     volunteerLevel: { $ref: '#/components/schemas/VolunteerLevel' }
 *                     next: { $ref: '#/components/schemas/Training' }
 *                 news:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/News' }
 */
router.get('/feed', optionalAuth, asyncHandler(controller.feed));

module.exports = router;
