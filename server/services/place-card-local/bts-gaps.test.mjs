import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CELL_DEG,
  gapCells,
  probePlan,
  summariseGaps,
  worstGaps,
} from './bts-gaps.mjs';

// Jayapura, a second tower 0.5° west of it, and nothing else.
const SITES = [
  { name: 'Jayapura · Telkomsel 4G', lat: -2.5337, lon: 140.7181 },
  { name: 'Sentani · Telkomsel 4G', lat: -2.5658, lon: 140.5212 },
];

test('a cell is only reported when its centre is inside a province', () => {
  const cells = gapCells(SITES, { cellDeg: 1 });
  assert.ok(cells.length > 0, 'the grid produced cells');
  for (const cell of cells) {
    assert.equal(typeof cell.province, 'string');
    assert.ok(cell.province.length > 0, 'every cell names its province');
    assert.equal(typeof cell.provinceId, 'string');
  }
});

test('a grid cell far from every tower reports a large distance', () => {
  const cells = gapCells(SITES, { cellDeg: 1 });
  const near = cells.filter((cell) => (cell.nearestKm ?? 999) < 100);
  const far = cells.filter((cell) => (cell.nearestKm ?? 0) > 200);
  assert.ok(near.length > 0, 'cells close to the towers exist');
  assert.ok(far.length > 0, 'cells far from the towers exist');
  const nearNames = new Set(near.map((cell) => cell.nearestSite));
  assert.ok(
    nearNames.has('Jayapura · Telkomsel 4G') ||
      nearNames.has('Sentani · Telkomsel 4G'),
    'the nearest tower is named',
  );
});

test('an empty registry makes every cell a gap instead of throwing', () => {
  const cells = gapCells([], { cellDeg: 2 });
  assert.ok(cells.length > 0);
  assert.ok(cells.every((cell) => cell.nearestKm === null));
});

test('worst gaps come first and respect the limit', () => {
  const cells = [
    { lat: 0, lon: 0, nearestKm: 5, province: 'A' },
    { lat: 1, lon: 1, nearestKm: 120, province: 'B' },
    { lat: 2, lon: 2, nearestKm: 60, province: 'C' },
  ];
  const worst = worstGaps(cells, { limit: 2 });
  assert.deepEqual(
    worst.map((cell) => cell.nearestKm),
    [120, 60],
  );
});

test('a minimum distance filters cells that are already served', () => {
  const cells = [
    { lat: 0, lon: 0, nearestKm: 5, province: 'A' },
    { lat: 1, lon: 1, nearestKm: 120, province: 'B' },
  ];
  const worst = worstGaps(cells, { limit: 10, minKm: 50 });
  assert.equal(worst.length, 1);
  assert.equal(worst[0].nearestKm, 120);
});

test('the probe plan thins cells that would buy the same ground twice', () => {
  const cells = [
    { lat: -4.0, lon: 138.0, nearestKm: 200, province: 'A' },
    { lat: -4.05, lon: 138.05, nearestKm: 190, province: 'A' },
    { lat: -6.0, lon: 140.0, nearestKm: 180, province: 'B' },
  ];
  const plan = probePlan(cells, { limit: 10, minSeparationKm: 12 });
  assert.equal(plan.length, 2, 'the two neighbouring cells collapse into one');
  assert.equal(plan[0].nearestKm, 200, 'the worst cell of a cluster wins');
  assert.equal(plan[1].province, 'B');
});

test('a probe plan never exceeds its limit', () => {
  const cells = Array.from({ length: 200 }, (_, index) => ({
    lat: -1 - index * 0.5,
    lon: 130 + index * 0.5,
    nearestKm: 300 - index,
    province: 'A',
  }));
  assert.equal(probePlan(cells, { limit: 7, minSeparationKm: 1 }).length, 7);
});

test('the summary reports median, p90 and worst without inventing numbers', () => {
  const cells = [
    { nearestKm: 10 },
    { nearestKm: 20 },
    { nearestKm: 30 },
    { nearestKm: 40 },
  ];
  const summary = summariseGaps(cells);
  assert.equal(summary.cells, 4);
  assert.equal(summary.medianKm, 30);
  assert.equal(summary.worstKm, 40);
  assert.ok(summary.p90Km >= summary.medianKm);
});

test('an empty cell list summarises to nulls, not zeros', () => {
  const summary = summariseGaps([]);
  assert.equal(summary.cells, 0);
  assert.equal(summary.medianKm, null);
  assert.equal(summary.worstKm, null);
});

test('the default grid is the documented 0.25 degrees', () => {
  assert.equal(DEFAULT_CELL_DEG, 0.25);
});

test('a non-positive cell size is refused', () => {
  assert.throws(() => gapCells(SITES, { cellDeg: 0 }), /positive/);
  assert.throws(() => gapCells(SITES, { cellDeg: -1 }), /positive/);
});
