'use strict';

const { Router } = require('express');
const { DOCUMENTS } = require('../../shared/legal-documents');

const router = Router();

/**
 * @openapi
 * /legal/{document}:
 *   get:
 *     tags: [Legal]
 *     summary: Yasal metinleri (KVKK, aydınlatma, açık rıza) versiyonlu olarak döner
 *     parameters:
 *       - in: path
 *         name: document
 *         required: true
 *         schema:
 *           type: string
 *           enum: [kvkk, aydinlatma-metni, acik-riza]
 *     responses:
 *       200:
 *         description: Metin
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version: { type: string }
 *                 updatedAt: { type: string, format: date }
 *                 title: { type: string }
 *                 body: { type: string }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:document', (req, res) => {
  const doc = DOCUMENTS[req.params.document];
  if (!doc) {
    return res.status(404).json({
      error: { code: 'not_found', message: 'Belge bulunamadı' },
    });
  }
  res.status(200).json(doc);
});

module.exports = router;
