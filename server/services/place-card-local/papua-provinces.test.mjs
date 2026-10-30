import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSiteIndex,
  distanceKm,
  findProvince,
  nearestSite,
  PAPUA_PROVINCES,
  provinceCoverage,
  provinceOf,
  sitesInProvince,
} from './papua-provinces.mjs';

test('the six provinces of Papua are all described', () => {
  assert.equal(PAPUA_PROVINCES.length, 6);
  const ids = PAPUA_PROVINCES.map((province) => province.id);
  assert.deepEqual(ids, [
    'papua-barat-daya',
    'papua-barat',
    'papua-tengah',
    'papua',
    'papua-pegunungan',
    'papua-selatan',
  ]);
  for (const province of PAPUA_PROVINCES) {
    assert.ok(province.capital, `${province.id} has a capital`);
    assert.ok(province.areaKm2 > 10000);
    const box = province.bbox;
    assert.ok(box.north > box.south && box.east > box.west);
  }
});

test('a coordinate lands in the right province', () => {
  const cases = [
    ['Jayapura', -2.5337, 140.7175, 'papua'],
    ['Wamena', -4.1, 138.95, 'papua-pegunungan'],
    ['Karubaga (Tolikara)', -3.6833, 138.4833, 'papua-pegunungan'],
    ['Waris (Keerom)', -3.4, 140.9, 'papua'],
    ['Timika', -4.5461, 136.8876, 'papua-tengah'],
    ['Nabire', -3.3667, 135.4833, 'papua-tengah'],
    ['Merauke', -8.4932, 140.4018, 'papua-selatan'],
    ['Agats (Asmat)', -5.55, 138.1, 'papua-selatan'],
    ['Sorong', -0.8763, 131.2558, 'papua-barat-daya'],
    ['Waisai (Raja Ampat)', -0.4333, 130.8167, 'papua-barat-daya'],
    ['Manokwari', -0.8615, 134.062, 'papua-barat'],
    ['Kaimana', -3.65, 133.75, 'papua-barat'],
    ['Fakfak', -2.9167, 132.3, 'papua-barat'],
    ['Biak', -1.1833, 136.0833, 'papua'],
  ];
  for (const [name, lat, lon, expected] of cases) {
    assert.equal(
      provinceOf(lat, lon)?.id,
      expected,
      `${name} is in ${expected}`,
    );
  }
});

test('a point outside Papua has no province', () => {
  assert.equal(provinceOf(-6.2088, 106.8456), null, 'Jakarta');
  assert.equal(provinceOf(Number.NaN, 140), null);
});

test('a province can be looked up by id or by name', () => {
  assert.equal(findProvince('papua-tengah').name, 'Papua Tengah');
  assert.equal(findProvince('Papua Selatan').id, 'papua-selatan');
  assert.equal(findProvince('nowhere'), null);
});

test('the nearest site is found without scanning the whole registry', () => {
  const sites = [
    { id: 'a', lat: -4.1, lon: 138.95, rangeKm: 5 },
    { id: 'b', lat: -2.53, lon: 140.72, rangeKm: 5 },
  ];
  const index = buildSiteIndex(sites);
  const found = nearestSite(index, -4.1, 138.95);
  assert.equal(found.site.id, 'a');
  assert.ok(found.distanceKm < 0.01);

  const far = nearestSite(index, -8.5, 140.4, { maxRing: 2 });
  assert.equal(far, null, 'beyond the search rings the answer is "none"');
});

test('coverage counts a point only inside a site radius', () => {
  // The site sits exactly on a grid point of the province box, so the
  // arithmetic is about the radius and not about where the sample landed.
  const province = findProvince('papua-pegunungan');
  const gridDeg = 0.5;
  const sites = [
    {
      id: 'wamena',
      lat: province.bbox.south + gridDeg * 3,
      lon: province.bbox.west + gridDeg * 3,
      tech: '4G',
      rangeKm: 5,
      cells: [],
    },
  ];
  const report = provinceCoverage(sites, { gridDeg });
  const pegunungan = report.provinces.find(
    (row) => row.id === 'papua-pegunungan',
  );
  assert.equal(pegunungan.sites, 1);
  assert.ok(pegunungan.coveredPoints > 0, 'the site covers its own grid point');
  assert.ok(
    pegunungan.coveredPct > 0 && pegunungan.coveredPct < 5,
    `one 5 km site is a small share of a 108,000 km² province: ${pegunungan.coveredPct}%`,
  );
  assert.equal(report.totals.sites, 1);
  assert.ok(
    report.totals.coveredPoints > 0,
    'the area is painted, even if it is tiny',
  );
  assert.ok(report.totals.coveredPct > 0, 'a small number, not a zero');
});

test('a province with no site is reported as uncovered, not missing', () => {
  const report = provinceCoverage([], { gridDeg: 1 });
  for (const row of report.provinces) {
    assert.equal(row.sites, 0);
    assert.equal(row.coveredPct, 0);
    assert.equal(
      row.medianNearestKm,
      null,
      'no site means no distance to report',
    );
    assert.ok(row.samplePoints > 0, 'the grid is still sampled');
  }
});

test('a wider radius covers more of the same province', () => {
  const narrow = provinceCoverage(
    [{ id: 'a', lat: -4.3, lon: 138.9, rangeKm: 5 }],
    {
      gridDeg: 0.5,
    },
  ).totals.coveredPoints;
  const wide = provinceCoverage(
    [{ id: 'a', lat: -4.3, lon: 138.9, rangeKm: 35 }],
    {
      gridDeg: 0.5,
    },
  ).totals.coveredPoints;
  assert.ok(
    wide > narrow,
    `${wide} points covered at 35 km vs ${narrow} at 5 km`,
  );
});

test('sites can be listed per province', () => {
  const sites = [
    { id: 'jyp', lat: -2.53, lon: 140.72 },
    { id: 'wmn', lat: -4.1, lon: 138.95 },
    { id: 'mrk', lat: -8.49, lon: 140.4 },
  ];
  assert.deepEqual(
    sitesInProvince(sites, 'papua-pegunungan').map((site) => site.id),
    ['wmn'],
  );
  assert.equal(sitesInProvince(sites, 'papua-barat').length, 0);
  assert.deepEqual(sitesInProvince(sites, 'nonsense'), []);
});

test('distance is great-circle and sane at a known separation', () => {
  // Jayapura to Wamena is about 260 km.
  const km = distanceKm(-2.5337, 140.7175, -4.1, 138.95);
  assert.ok(km > 240 && km < 290, `measured ${km} km`);
});
