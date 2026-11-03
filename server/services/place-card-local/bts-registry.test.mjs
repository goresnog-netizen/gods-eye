import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BTS_SEED,
  bearing,
  carrierAlias,
  describePoint,
  distanceKm,
  findCells,
  nearestTowers,
  towersOfOperator,
  trilaterate,
} from './bts-registry.mjs';

const SITE = (id, lat, lon, rangeKm = 5) => ({
  id,
  name: id,
  lat,
  lon,
  tech: '4G',
  rangeKm,
});

test('the seed covers Papua and says it is synthetic', () => {
  assert.ok(BTS_SEED.length >= 30, `sites: ${BTS_SEED.length}`);
  for (const site of BTS_SEED) {
    assert.equal(
      site.synthetic,
      true,
      'the seed never claims to be operator data',
    );
    assert.ok(Number.isFinite(site.lat) && Number.isFinite(site.lon));
    assert.ok(site.rangeKm > 0);
    assert.deepEqual(site.cells, [], 'no invented cell ids');
  }
});

test('distance is the great-circle one', () => {
  // Jayapura to Wamena is roughly 260 km.
  const km = distanceKm(-2.5337, 140.7175, -4.1, 138.95);
  assert.ok(km > 240 && km < 290, `got ${km}`);
  assert.equal(Math.round(distanceKm(0, 0, 0, 0)), 0);
});

test('bearing points from the origin to the site', () => {
  const north = bearing(0, 0, 1, 0);
  const east = bearing(0, 0, 0, 1);
  assert.ok(Math.abs(north) < 0.5 || Math.abs(north - 360) < 0.5);
  assert.ok(Math.abs(east - 90) < 0.5);
});

test('the nearest sites come first and the limit holds', () => {
  const registry = [
    SITE('far', 0.5, 0),
    SITE('near', 0.01, 0),
    SITE('mid', 0.1, 0),
  ];
  const found = nearestTowers(registry, 0, 0, { limit: 2 });
  assert.deepEqual(
    found.map((site) => site.id),
    ['near', 'mid'],
  );
  assert.ok(found[0].distanceKm < found[1].distanceKm);
});

test('a radius filter drops the sites outside it', () => {
  const registry = [SITE('near', 0.01, 0), SITE('far', 0.5, 0)];
  const found = nearestTowers(registry, 0, 0, { radiusKm: 5 });
  assert.deepEqual(
    found.map((site) => site.id),
    ['near'],
  );
});

test('coverage is a share of the site’s own range', () => {
  const registry = [SITE('only', 0, 0, 5)];
  const [tower] = nearestTowers(registry, 0.02, 0, { limit: 1 });
  // 0.02° of latitude is about 2.2 km, which is 44% of a 5 km cell.
  assert.ok(
    tower.coveragePct >= 40 && tower.coveragePct <= 50,
    `${tower.coveragePct}%`,
  );
});

test('near, mid, edge and far follow the coverage share', () => {
  const registry = [SITE('only', 0, 0, 5)];
  const at = (lat) => describePoint(registry, lat, 0, { limit: 1 }).class;
  assert.equal(at(0), 'near');
  assert.equal(at(0.02), 'near');
  assert.equal(at(0.04), 'mid');
  assert.equal(at(0.06), 'edge');
  assert.equal(at(0.15), 'far');
});

test('a point inside the planning radius is in coverage', () => {
  const registry = [SITE('only', 0, 0, 5)];
  assert.equal(describePoint(registry, 0.02, 0).inCoverage, true);
  assert.equal(describePoint(registry, 0.15, 0).inCoverage, false);
});

test('an empty registry answers unknown instead of guessing', () => {
  const described = describePoint([], -4.5, 138.5);
  assert.equal(described.nearest, null);
  assert.equal(described.inCoverage, null);
  assert.equal(described.class, 'unknown');
  assert.deepEqual(described.towers, []);
});

test('the seed carries no cell ids, so no cell can be claimed', () => {
  const matches = findCells(BTS_SEED, [{ lac: 12345, cellId: 67890 }]);
  assert.deepEqual(matches, []);
});

test('a registry with cell ids is matched by lac and cell', () => {
  const registry = [
    { ...SITE('a', -2.5, 140.7), cells: [{ lac: 100, cellId: 200 }] },
    { ...SITE('b', -4.5, 136.9), cells: [{ lac: 300, cellId: 400 }] },
  ];
  const matches = findCells(registry, [{ lac: 300, cellId: 400 }]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].site.id, 'b');
});

test('two sites place a target between them', () => {
  const placed = trilaterate([
    { lat: 0, lon: 0, weight: 1 },
    { lat: 0, lon: 2, weight: 1 },
  ]);
  assert.equal(placed.ok, true);
  assert.equal(placed.samples, 2);
  assert.equal(placed.lon, 1);
  assert.equal(placed.lat, 0);
});

test('one site is not a position', () => {
  const placed = trilaterate([{ lat: 0, lon: 0, weight: 1 }]);
  assert.equal(placed.ok, false);
  assert.match(placed.reason, /two known sites/);
});

test('a heavier site pulls the estimate towards it', () => {
  const placed = trilaterate([
    { lat: 0, lon: 0, weight: 3 },
    { lat: 0, lon: 1, weight: 1 },
  ]);
  assert.ok(placed.lon > 0 && placed.lon < 0.5, `lon ${placed.lon}`);
});

test('three towers in a row give a long, thin answer, and the ellipse says so', () => {
  // Three masts on a line can only place the target along that line: the
  // across-line spread is tiny, the along-line spread is not. A single point
  // would hide that completely.
  const placed = trilaterate([
    { lat: 0, lon: 0, weight: 1 },
    { lat: 0, lon: 2, weight: 1 },
    { lat: 0, lon: 4, weight: 1 },
  ]);
  assert.equal(placed.ok, true);
  assert.ok(placed.ellipse, 'the answer carries its uncertainty');
  assert.ok(
    placed.ellipse.semiMajorM > placed.ellipse.semiMinorM * 3,
    `major ${placed.ellipse.semiMajorM} m vs minor ${placed.ellipse.semiMinorM} m`,
  );
  assert.ok(placed.ellipse.azimuthDeg >= 0 && placed.ellipse.azimuthDeg < 180);
});

test('a ring of towers gives a round answer', () => {
  // Same spread as the line above, but arranged around the target: now the
  // position is pinned in both directions.
  const placed = trilaterate([
    { lat: 1, lon: 0, weight: 1 },
    { lat: -1, lon: 0, weight: 1 },
    { lat: 0, lon: 1, weight: 1 },
    { lat: 0, lon: -1, weight: 1 },
  ]);
  assert.ok(placed.ellipse);
  assert.ok(
    Math.abs(placed.ellipse.semiMajorM - placed.ellipse.semiMinorM) <
      placed.ellipse.semiMajorM * 0.5,
    `ring is round: major ${placed.ellipse.semiMajorM}, minor ${placed.ellipse.semiMinorM}`,
  );
});

test('carrierAlias folds the different spellings of one operator', () => {
  assert.equal(carrierAlias('Telkomsel'), 'telkomsel');
  assert.equal(carrierAlias('Indosat Ooredoo Hutchison'), 'indosat');
  assert.equal(carrierAlias('Indosat'), 'indosat');
  assert.equal(carrierAlias('Tri'), 'indosat');
  assert.equal(carrierAlias('3 (Three)'), 'indosat');
  assert.equal(carrierAlias('XL Axiata'), 'xl');
  assert.equal(carrierAlias('AXIS'), 'axis');
  assert.equal(carrierAlias('Smartfren'), 'smartfren');
  assert.equal(carrierAlias('Random ISP'), null);
});

test('towersOfOperator lists only the operator and sorts nearest first', () => {
  const registry = [
    { id: 'a', name: 'Kota · Telkomsel 4G', lat: -2.53, lon: 140.71, tech: '4G', rangeKm: 5, cells: [{ lac: 1, cellId: 2 }] },
    { id: 'b', name: 'Kota · XL Axiata 4G', lat: -2.53, lon: 140.72, tech: '4G', rangeKm: 5 },
    { id: 'c', name: 'Luar · Telkomsel 4G', lat: -2.6, lon: 140.8, tech: '4G', rangeKm: 5 },
    { id: 'd', name: 'Jauh · Telkomsel 4G', lat: -4.0, lon: 138.0, tech: '4G', rangeKm: 5 },
  ];
  const towers = towersOfOperator(registry, 'Telkomsel', -2.53, 140.71, {
    radiusKm: 30,
    limit: 8,
  });
  assert.equal(towers.length, 2, 'XL tower is not Telkomsel, far tower is out of range');
  assert.ok(towers.every((t) => t.name.includes('Telkomsel')));
  assert.equal(towers[0].id, 'a', 'nearest first');
  assert.equal(towers[0].distanceKm, 0);
  assert.ok(towers[0].distanceKm <= towers[1].distanceKm);

  // carrierOf callback: MNC decides, not the name.
  const byMnc = towersOfOperator(
    [
      { id: 'x', name: 'Anything', mcc: 510, mnc: 10, lat: -2.5, lon: 140.7, tech: '4G' },
      { id: 'y', name: 'Anything', mcc: 510, mnc: 30, lat: -2.5, lon: 140.71, tech: '4G' },
    ],
    'Telkomsel',
    -2.5,
    140.7,
    {
      radiusKm: 30,
      carrierOf: (site) =>
        ({ '510-10': 'Telkomsel', '510-30': 'XL Axiata' })[`${site.mcc}-${site.mnc}`] ||
        null,
    },
  );
  assert.equal(byMnc.length, 1);
  assert.equal(byMnc[0].id, 'x');
});
