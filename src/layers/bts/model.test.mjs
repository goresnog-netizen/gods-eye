import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TECH_COLORS,
  TIER_ALTITUDES,
  TIER_LIMITS,
  densityTier,
  distanceKm,
  layerStatus,
  selectVisibleSites,
  sitesFromPayload,
  techColor,
} from './model.js';

const WAMENA = { lat: -4.1, lon: 138.95 };

function site(id, lat, lon, tech = '4G') {
  return { id, name: id, lat, lon, tech, rangeKm: 5, cells: [], samples: 3 };
}

test('altitude decides the tier, and the boundaries are where cells stop resolving', () => {
  assert.equal(densityTier(1000), 'cells', 'street level: everything');
  assert.equal(densityTier(TIER_ALTITUDES.cells), 'cells');
  assert.equal(densityTier(TIER_ALTITUDES.cells + 1), 'sites');
  assert.equal(densityTier(TIER_ALTITUDES.sites), 'sites');
  assert.equal(densityTier(TIER_ALTITUDES.sites + 1), 'province');
  assert.equal(densityTier(5_000_000), 'province');
});

test('a nonsense altitude answers with the most detail, not a refusal', () => {
  assert.equal(densityTier(Number.NaN), 'cells');
  assert.equal(densityTier(-5), 'cells');
});

test('the nearest sites are the ones drawn, not the first in the file', () => {
  // Every one of these is inside the 60 km fovea (checked: 0.02, 35, 42, 45 km).
  const sites = [
    site('far', -4.5, 138.9),
    site('near', -4.1001, 138.9501),
    site('mid', -4.3, 139.2),
    site('farther', -3.95, 139.3),
  ];
  const visible = selectVisibleSites(sites, WAMENA, 'cells');
  assert.equal(visible[0].id, 'near', 'the closest tower is drawn first');
  assert.equal(visible[0].distanceKm < 0.1, true);
  assert.equal(visible.length, 4, 'all four are inside the 60 km fovea');
  // The order is by distance, not by position in the file: 'far' was first in
  // the array and is drawn last.
  assert.equal(visible[3].id, 'far');
});

test('a site beyond the tier radius is not drawn', () => {
  // ~300 km away: inside the sites tier's 400 km radius, far outside the
  // cells fovea's 60 km.
  const sites = [site('elsewhere', -1.5, 140.5)];
  assert.equal(selectVisibleSites(sites, WAMENA, 'cells').length, 0);
  assert.equal(selectVisibleSites(sites, WAMENA, 'sites').length, 1);
});

test('the province tier draws nothing — the globe is not a spreadsheet', () => {
  const sites = [site('a', -4.1, 138.95), site('b', -4.2, 139.0)];
  assert.deepEqual(selectVisibleSites(sites, WAMENA, 'province'), []);
});

test('the entity budget keeps the closest, so a zoom cannot melt the GPU', () => {
  const many = [];
  for (let i = 0; i < 600; i += 1) {
    // A 0.34 x 0.34 degree block (~38 km across, diagonal ~54 km): every site
    // is inside the fovea, so the budget is the only thing that can drop one.
    many.push(
      site(
        `s${i}`,
        -4.1 + (i % 20) * 0.018,
        138.95 + Math.floor(i / 20) * 0.018,
      ),
    );
  }
  const visible = selectVisibleSites(many, WAMENA, 'cells');
  assert.equal(visible.length, TIER_LIMITS.cells, 'the budget is honoured');
  // Distances increase monotonically: what was dropped is the least relevant,
  // never an arbitrary slice of the file.
  for (let i = 1; i < visible.length; i += 1) {
    assert.ok(
      visible[i].distanceKm >= visible[i - 1].distanceKm,
      `drawn in order at ${i}`,
    );
  }
  assert.equal(many.length - visible.length, 200, 'the rest are dropped');
});

test('the status line says the globe is filtered, so empty reads as zoomed out', () => {
  const far = layerStatus({
    total: 1901,
    shown: 0,
    tier: 'province',
    altitudeM: 900000,
  });
  assert.match(far.note, /Zoom in/);

  const near = layerStatus({
    total: 1901,
    shown: 412,
    tier: 'cells',
    altitudeM: 20000,
  });
  assert.match(near.note, /1901 towers · 412 within 60 km/);

  const all = layerStatus({
    total: 42,
    shown: 42,
    tier: 'sites',
    altitudeM: 200000,
  });
  assert.match(all.note, /42 towers shown/);
  assert.equal(all.note.includes('within'), false, 'nothing was dropped');
});

test('distance is a real great circle, not a flat approximation', () => {
  // Jayapura to Wamena: ~262 km as the crow flies, measured against the
  // published coordinates of both towns.
  const d = distanceKm(-2.5337, 140.7175, -4.1, 138.95);
  assert.ok(d > 250 && d < 275, `got ${d.toFixed(1)} km`);
  assert.equal(distanceKm(0, 0, 0, 0), 0);
});

test('technology colours match the panel vocabulary', () => {
  assert.equal(techColor('4G'), TECH_COLORS['4G']);
  assert.equal(techColor('4g'), TECH_COLORS['4G'], 'case does not matter');
  assert.equal(
    techColor('LTE'),
    TECH_COLORS.unknown,
    'an unknown radio is grey',
  );
  assert.equal(techColor(null), TECH_COLORS.unknown);
});

test('a registry payload becomes the flat list the globe draws', () => {
  const sites = sitesFromPayload({
    sites: [
      {
        id: 'a',
        name: 'Sentani · Telkomsel 4G',
        lat: -2.5658,
        lon: 140.5212,
        tech: '4G',
        rangeKm: 5,
        cells: [{ lac: 1, cellId: 2 }],
        samples: 9,
      },
      { id: 'b', name: 'Bad', lat: 'x', lon: 1 },
      { id: 'c', name: 'No cells', lat: -4.1, lon: 138.95, tech: '3G' },
    ],
  });
  assert.equal(
    sites.length,
    2,
    'an unparseable coordinate is dropped, not guessed',
  );
  assert.equal(sites[0].cells, 1, 'the cell count is carried, not the cells');
  assert.equal(sites[1].cells, 0, 'a missing list is zero, not a crash');
});

test('an empty payload is an empty layer, not an error', () => {
  assert.deepEqual(sitesFromPayload(null), []);
  assert.deepEqual(sitesFromPayload({}), []);
  assert.deepEqual(sitesFromPayload({ sites: 'nope' }), []);
});
