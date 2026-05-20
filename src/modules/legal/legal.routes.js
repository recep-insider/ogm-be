'use strict';

const { Router } = require('express');

const router = Router();

const DOCUMENTS = {
  kvkk: {
    version: 'v1.0',
    updatedAt: '2026-04-27',
    title: 'KVKK Aydınlatma Metni',
    body:
      'Kişisel verileriniz, T.C. Orman Genel Müdürlüğü tarafından 6698 sayılı KVKK kapsamında ' +
      'orman gönüllüsü kayıt ve yönetim süreçleri için işlenmektedir. Saklama süresi: aktif ' +
      'kullanım süresince + 9 yıl (Sağlık Bakanlığı raporu yasası gereği). Verilerinizin tümünü ' +
      'GET /v1/users/me/data-export ile indirebilir, DELETE /v1/users/me ile silebilirsiniz.',
  },
  'aydinlatma-metni': {
    version: 'v1.0',
    updatedAt: '2026-04-27',
    title: 'Aydınlatma Metni',
    body:
      'Bu metin, 6698 sayılı KVKK Madde 10 kapsamında tarafınıza sunulan aydınlatma metnidir. ' +
      'Toplanan veriler: TC Kimlik, Ad, Soyad, Doğum Tarihi, Telefon, E-posta, Adres, Kan Grubu, ' +
      'Sağlık Raporu, Sabıka Kaydı. Hukuki sebepler: kanuni yükümlülük + açık rıza.',
  },
  'acik-riza': {
    version: 'v1.0',
    updatedAt: '2026-04-27',
    title: 'Açık Rıza Metni',
    body:
      'Yukarıda belirtilen kişisel verilerimin (özel nitelikli sağlık raporu ve sabıka kaydı dahil) ' +
      'OGM tarafından gönüllü yönetimi süreçleri için işlenmesine açık rıza gösteriyorum.',
  },
};

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
