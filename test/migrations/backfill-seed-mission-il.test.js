'use strict';

const migration = require('../../migrations/20261024100000_backfill_seed_mission_il');

// Bellek içi knex: missions satırları; where(obj), where(fn → whereNull/orWhere) ve update.
function makeKnex(rows) {
  const knex = jest.fn(() => {
    const preds = [];
    const q = {
      where: jest.fn((f) => {
        if (typeof f === 'function') {
          const ors = [];
          const sub = {
            whereNull: (col) => {
              ors.push((r) => r[col] == null);
              return sub;
            },
            orWhere: (col, val) => {
              ors.push((r) => r[col] === val);
              return sub;
            },
          };
          f(sub);
          preds.push((r) => ors.some((p) => p(r)));
        } else {
          preds.push((r) => Object.entries(f).every(([k, v]) => r[k] === v));
        }
        return q;
      }),
      update: jest.fn(async (patch) => {
        const hit = rows.filter((r) => preds.every((p) => p(r)));
        hit.forEach((r) => Object.assign(r, patch));
        return hit.length;
      }),
    };
    return q;
  });
  return knex;
}

const regionOf = (rows) => rows.map((r) => [r.id, r.il, r.ilce]);

describe('20261024100000_backfill_seed_mission_il', () => {
  it('yalnız üç seed olayının boş (null ya da "") il/ilçesini seed değerleriyle doldurur', async () => {
    const rows = [
      { id: 'am_marmaris', il: null, ilce: null },
      { id: 'am_fethiye', il: '', ilce: null },
      { id: 'fm_marmaris_2025', il: null, ilce: '' },
      { id: 'm_other', il: null, ilce: null }, // listede değil: dokunulmaz
    ];

    await migration.up(makeKnex(rows));

    expect(regionOf(rows)).toEqual([
      ['am_marmaris', 'Muğla', 'Marmaris'],
      ['am_fethiye', 'Muğla', 'Fethiye'],
      ['fm_marmaris_2025', 'Muğla', 'Marmaris'],
      ['m_other', null, null],
    ]);
  });

  it('il zaten doluysa (elle girilmiş) ezmez', async () => {
    const rows = [
      { id: 'am_marmaris', il: 'Muğla', ilce: 'Datça' },
      { id: 'am_fethiye', il: 'Antalya', ilce: null },
      { id: 'fm_marmaris_2025', il: null, ilce: null },
    ];

    await migration.up(makeKnex(rows));

    expect(regionOf(rows)).toEqual([
      ['am_marmaris', 'Muğla', 'Datça'],
      ['am_fethiye', 'Antalya', null],
      ['fm_marmaris_2025', 'Muğla', 'Marmaris'],
    ]);
  });

  it('down yalnız hâlâ yazılan değerleri taşıyan satırları boşaltır', async () => {
    const rows = [
      { id: 'am_marmaris', il: null, ilce: null },
      { id: 'am_fethiye', il: null, ilce: null },
      { id: 'fm_marmaris_2025', il: null, ilce: null },
      { id: 'm_other', il: 'Muğla', ilce: 'Marmaris' }, // listede değil: dokunulmaz
    ];
    const knex = makeKnex(rows);

    await migration.up(knex);
    // up'tan sonra panelden düzeltilen kayıtlar korunur.
    rows[1].ilce = 'Seydikemer';
    rows[2].il = 'Aydın';

    await migration.down(knex);

    expect(regionOf(rows)).toEqual([
      ['am_marmaris', null, null],
      ['am_fethiye', 'Muğla', 'Seydikemer'],
      ['fm_marmaris_2025', 'Aydın', 'Marmaris'],
      ['m_other', 'Muğla', 'Marmaris'],
    ]);
  });

  it('yalnız missions tablosuna ve olay başına tek güncelleme yazar', async () => {
    const knex = makeKnex([]);

    await migration.up(knex);
    await migration.down(knex);

    expect(knex.mock.calls).toEqual(Array(6).fill(['missions']));
  });
});
