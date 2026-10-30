import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisionBboxSource } from './source.js';

test('createVisionBboxSource without overlayHost still works', () => {
  const source = createVisionBboxSource();
  const count = source.setDetections(
    [{ kind: 'person', box: [0.25, 0.25, 0.5, 0.5], confidence: 0.8 }],
    { lat: -4.1, lon: 138.95, widthM: 2000, heightM: 2000 },
  );
  assert.equal(count, 0);
  assert.deepEqual(source.snapshot().detections.length, 1);
  assert.equal(source.flyToDetection(0), null);
});

test('createVisionBboxSource with overlayHost passes detections through', () => {
  let lastEntries = [];
  const overlayHost = {
    setEntries: (entries) => {
      lastEntries = entries;
    },
  };
  const source = createVisionBboxSource({ overlayHost });
  const detections = [
    { kind: 'person', box: [0.25, 0.25, 0.5, 0.5], confidence: 0.8 },
    { kind: 'vehicle', box: [0.6, 0.6, 0.3, 0.3], confidence: 0.6 },
  ];
  const footprint = { lat: -4.1, lon: 138.95, widthM: 2000, heightM: 2000 };
  const count = source.setDetections(detections, footprint);
  assert.equal(count, 2);
  assert.equal(lastEntries.length, 2);
  assert.equal(lastEntries[0].kind, 'person');
  assert.equal(lastEntries[1].kind, 'vehicle');
  assert.deepEqual(lastEntries[0].polygon.positions.length, 4);
});

test('createVisionBboxSource filters out detections without valid boxes', () => {
  let lastEntries = [];
  const overlayHost = {
    setEntries: (entries) => {
      lastEntries = entries;
    },
  };
  const source = createVisionBboxSource({ overlayHost });
  const detections = [
    { kind: 'person', box: [0.25, 0.25, 0.5, 0.5], confidence: 0.8 },
    { kind: 'vehicle', box: [1, 1, -0.5, -0.5], confidence: 0.6 },
  ];
  const footprint = { lat: -4.1, lon: 138.95, widthM: 2000, heightM: 2000 };
  const count = source.setDetections(detections, footprint);
  assert.equal(count, 1);
  assert.equal(lastEntries.length, 1);
  assert.equal(lastEntries[0].kind, 'person');
});

test('createVisionBboxSource clear empties everything', () => {
  let lastEntries = [];
  const overlayHost = {
    setEntries: (entries) => {
      lastEntries = entries;
    },
  };
  const source = createVisionBboxSource({ overlayHost });
  source.setDetections(
    [{ kind: 'person', box: [0.25, 0.25, 0.5, 0.5], confidence: 0.8 }],
    { lat: -4.1, lon: 138.95, widthM: 2000, heightM: 2000 },
  );
  assert.equal(lastEntries.length, 1);
  source.clear();
  assert.equal(lastEntries.length, 0);
  assert.deepEqual(source.snapshot().detections, []);
  assert.equal(source.snapshot().footprint, null);
});

test('createVisionBboxSource flyToDetection returns null without footprint', () => {
  const source = createVisionBboxSource();
  source.setDetections(
    [{ kind: 'person', box: [0.25, 0.25, 0.5, 0.5], confidence: 0.8 }],
    null,
  );
  assert.equal(source.flyToDetection(0), null);
});

test('createVisionBboxSource flyToDetection returns centre of detection box', () => {
  const overlayHost = { setEntries: () => {} };
  const source = createVisionBboxSource({ overlayHost });
  const footprint = { lat: -4.1, lon: 138.95, widthM: 2000, heightM: 2000 };
  source.setDetections(
    [{ kind: 'person', box: [0.25, 0.25, 0.5, 0.5], confidence: 0.8 }],
    footprint,
  );
  const point = source.flyToDetection(0);
  assert.ok(point !== null);
  // Centre of 0.25,0.25,0.5,0.5 is 0.5,0.5 → footprint centre.
  assert.equal(Math.abs(point.lat - footprint.lat) < 1e-6, true);
  assert.equal(Math.abs(point.lon - footprint.lon) < 1e-6, true);
});

test('createVisionBboxSource snapshot is immutable', () => {
  const source = createVisionBboxSource();
  const snapshot = source.snapshot();
  snapshot.detections.push({ kind: 'person', box: [0, 0, 0, 0] });
  // Snapshot is a fresh array; pushing to it does not affect internal state.
  assert.equal(source.snapshot().detections.length, 0);
});
