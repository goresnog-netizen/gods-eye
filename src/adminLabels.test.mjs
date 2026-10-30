import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_LEVELS,
  ADMIN_UNITS,
  LEVEL_RANGES,
  MAX_VISIBLE_LABELS,
} from './data/adminLabels.js';
import {
  countByLevel,
  formatUnitLabel,
  levelForHeight,
  selectVisibleUnits,
  describeUnits,
} from './ui/adminLabels.js';

const UNITS = [
  { id: 'p1', name: 'Province', level: 1, lat: 0, lon: 0, kind: 'provinsi' },
  { id: 'r1', name: 'Regency', level: 2, lat: 1, lon: 1, kind: 'kabupaten' },
  { id: 'd1', name: 'District', level: 3, lat: 2, lon: 2, kind: 'kecamatan' },
  { id: 'v1', name: 'Village', level: 4, lat: 3, lon: 3, kind: 'desa' },
];

test('a camera far out reads provinces only', () => {
  assert.equal(levelForHeight(5_000_000), ADMIN_LEVELS.province);
  assert.equal(levelForHeight(2_000_000), ADMIN_LEVELS.province);
});

test('each level appears as the camera closes in', () => {
  assert.equal(levelForHeight(399_999), ADMIN_LEVELS.district);
  assert.equal(levelForHeight(400_000), ADMIN_LEVELS.regency);
  assert.equal(levelForHeight(1_999_999), ADMIN_LEVELS.regency);
  assert.equal(levelForHeight(2_000_000), ADMIN_LEVELS.province);
  assert.equal(levelForHeight(90_000), ADMIN_LEVELS.district);
  assert.equal(levelForHeight(89_999), ADMIN_LEVELS.village);
  assert.equal(levelForHeight(0), ADMIN_LEVELS.village);
});

test('an unusable height answers with the widest level', () => {
  assert.equal(levelForHeight(Number.NaN), ADMIN_LEVELS.province);
  assert.equal(levelForHeight(undefined), ADMIN_LEVELS.province);
  assert.equal(levelForHeight(-5), ADMIN_LEVELS.province);
});

test('only the level that reads is offered', () => {
  assert.deepEqual(
    selectVisibleUnits(UNITS, 3_000_000).map((unit) => unit.id),
    ['p1'],
  );
  assert.deepEqual(
    selectVisibleUnits(UNITS, 500_000).map((unit) => unit.id),
    ['r1'],
  );
  assert.deepEqual(
    selectVisibleUnits(UNITS, 1_000).map((unit) => unit.id),
    ['v1'],
  );
});

test('the cap keeps the globe readable', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `r${i}`,
    name: `Regency ${i}`,
    level: 2,
    lat: 0,
    lon: 0,
    kind: 'kabupaten',
  }));
  // 40 units is under the cap, so all of them are offered.
  assert.equal(selectVisibleUnits(many, 500_000).length, 40);
  assert.equal(selectVisibleUnits(many, 500_000, { max: 5 }).length, 5);
  // A district list longer than the cap is cut, provinces first.
  const crowded = Array.from({ length: 120 }, (_, i) => ({
    id: `d${i}`,
    name: `District ${i}`,
    level: 3,
    lat: 0,
    lon: 0,
    kind: 'kecamatan',
  }));
  assert.equal(
    selectVisibleUnits(crowded, 200_000).length,
    MAX_VISIBLE_LABELS,
  );
});

test('an empty or broken list shows nothing', () => {
  assert.deepEqual(selectVisibleUnits([], 1_000_000), []);
  assert.deepEqual(selectVisibleUnits(null, 1_000_000), []);
  assert.deepEqual(selectVisibleUnits(UNITS, 1_000_000, { max: 0 }).length, 1);
});

test('counts are reported per level', () => {
  assert.deepEqual(countByLevel(UNITS), { 1: 1, 2: 1, 3: 1, 4: 1 });
  assert.deepEqual(countByLevel([{ level: 2 }, { level: 2 }]), { 2: 2 });
  assert.deepEqual(countByLevel(null), {});
});

test('a label carries its name and its kind', () => {
  assert.deepEqual(formatUnitLabel(UNITS[0]), {
    title: 'Province',
    detail: 'provinsi',
  });
  assert.deepEqual(formatUnitLabel({}), { title: '—', detail: '' });
});

test('the seed is Papuan, complete and marked synthetic', () => {
  assert.ok(ADMIN_UNITS.length >= 40, `units: ${ADMIN_UNITS.length}`);
  const counts = countByLevel(ADMIN_UNITS);
  assert.ok(counts[1] >= 6, 'six provinces');
  assert.ok(counts[2] >= 30, 'regencies');
  assert.ok(counts[3] >= 10, 'districts');
  for (const unit of ADMIN_UNITS) {
    assert.equal(unit.synthetic, true, 'the seed never claims to be a survey');
    assert.ok(Number.isFinite(unit.lat) && Number.isFinite(unit.lon));
    assert.ok(unit.id);
  }
  const ids = new Set(ADMIN_UNITS.map((unit) => unit.id));
  assert.equal(ids.size, ADMIN_UNITS.length, 'ids are unique');
});

test('the level ranges are ordered and cover every height', () => {
  for (let i = 1; i < LEVEL_RANGES.length; i += 1) {
    assert.ok(
      LEVEL_RANGES[i].minHeightM < LEVEL_RANGES[i - 1].minHeightM,
      'ranges descend',
    );
  }
  assert.equal(LEVEL_RANGES[LEVEL_RANGES.length - 1].minHeightM, 0);
});

test('the status line counts what is available', () => {
  const text = describeUnits(ADMIN_UNITS, 'local-seed');
  assert.match(text, /local-seed/);
  assert.match(text, /\d+/);
  assert.match(describeUnits([], 'x'), /NO PLACES/);
});
