import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bboxToGroundRect,
  rectCentre,
  estimateFootprintM,
} from './model.js';

const WAMENA = Object.freeze({ lat: -4.1, lon: 138.95, widthM: 2000, heightM: 2000 });

test('bboxToGroundRect rejects invalid boxes', () => {
  assert.deepEqual(bboxToGroundRect(null, WAMENA), []);
  assert.deepEqual(bboxToGroundRect([], WAMENA), []);
  assert.deepEqual(bboxToGroundRect([1, 2], WAMENA), []);
  assert.deepEqual(bboxToGroundRect([1, 2, 3], WAMENA), []);
  assert.deepEqual(bboxToGroundRect([1, 2, 3, 4, 5], WAMENA), []);
  assert.deepEqual(bboxToGroundRect(['a', 'b', 'c', 'd'], WAMENA), []);
  assert.deepEqual(bboxToGroundRect([NaN, 0, 0, 0], WAMENA), []);
});

test('bboxToGroundRect rejects invalid footprints', () => {
  assert.deepEqual(bboxToGroundRect([0.25, 0.25, 0.5, 0.5], null), []);
  assert.deepEqual(bboxToGroundRect([0.25, 0.25, 0.5, 0.5], {}), []);
  assert.deepEqual(
    bboxToGroundRect([0.25, 0.25, 0.5, 0.5], { lat: 'a', lon: 1, widthM: 1, heightM: 1 }),
    [],
  );
  assert.deepEqual(
    bboxToGroundRect([0.25, 0.25, 0.5, 0.5], { lat: 0, lon: 0, widthM: 0, heightM: 1 }),
    [],
  );
  assert.deepEqual(
    bboxToGroundRect([0.25, 0.25, 0.5, 0.5], { lat: 0, lon: 0, widthM: 1, heightM: 0 }),
    [],
  );
});

test('bboxToGroundRect rejects zero-area boxes', () => {
  assert.deepEqual(bboxToGroundRect([0.25, 0.25, 0, 0.5], WAMENA), []);
  assert.deepEqual(bboxToGroundRect([0.25, 0.25, 0.5, 0], WAMENA), []);
  assert.deepEqual(bboxToGroundRect([0.25, 0.25, -0.5, 0.5], WAMENA), []);
});

test('bboxToGroundRect clamps box coordinates to [0,1]', () => {
  // Full frame: box outside 0..1 is clamped to the edges.
  const full = bboxToGroundRect([0, 0, 1, 1], WAMENA);
  assert.equal(full.length, 4);
  const degPer1000m = 1000 / 111320;
  const cosLat = Math.max(1e-4, Math.cos(Math.abs(WAMENA.lat) * Math.PI / 180));
  const degLonPer1000m = degPer1000m / cosLat;
  assert.equal(Math.abs(full[0].lat - (WAMENA.lat + degPer1000m)) < 1e-9, true);
  assert.equal(Math.abs(full[0].lon - (WAMENA.lon - degLonPer1000m)) < 1e-9, true);
  assert.equal(Math.abs(full[2].lat - (WAMENA.lat - degPer1000m)) < 1e-9, true);
  assert.equal(Math.abs(full[2].lon - (WAMENA.lon + degLonPer1000m)) < 1e-9, true);
});

test('bboxToGroundRect centres a box in the footprint', () => {
  // Centre of footprint: the centre of the box should map to the footprint centre.
  const centre = bboxToGroundRect([0.25, 0.25, 0.5, 0.5], WAMENA);
  assert.equal(centre.length, 4);
  // The centre of the returned rectangle should equal WAMENA centre.
  const c = rectCentre(centre);
  assert.ok(c !== null);
  assert.equal(Math.abs(c.lat - WAMENA.lat) < 1e-6, true);
  assert.equal(Math.abs(c.lon - WAMENA.lon) < 1e-6, true);
});

test('rectCentre returns null for invalid input', () => {
  assert.equal(rectCentre(null), null);
  assert.equal(rectCentre([]), null);
  assert.equal(rectCentre([{ lat: 0, lon: 0 }]), null);
});

test('rectCentre computes the arithmetic mean', () => {
  const corners = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 10 },
    { lat: 10, lon: 10 },
    { lat: 10, lon: 0 },
  ];
  const c = rectCentre(corners);
  assert.ok(c !== null);
  assert.equal(c.lat, 5);
  assert.equal(c.lon, 5);
});

test('estimateFootprintM rejects invalid altitude', () => {
  const zero = estimateFootprintM(0);
  assert.equal(zero.widthM, 0);
  assert.equal(zero.heightM, 0);
  const neg = estimateFootprintM(-100);
  assert.equal(neg.widthM, 0);
  assert.equal(neg.heightM, 0);
  const nan = estimateFootprintM(NaN);
  assert.equal(nan.widthM, 0);
  assert.equal(nan.heightM, 0);
});

test('estimateFootprintM grows linearly with altitude', () => {
  const h1 = estimateFootprintM(1000);
  const h2 = estimateFootprintM(2000);
  assert.equal(Math.abs(h2.widthM / h1.widthM - 2) < 1e-4, true);
});
