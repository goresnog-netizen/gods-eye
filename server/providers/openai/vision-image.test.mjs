import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import {
  VISION_MAX_EDGE_DEFAULT,
  VISION_MIN_USEFUL_EDGE,
  normaliseImage,
  visionMaxEdge,
} from './vision-image.js';

const jpeg = (width, height) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 120, b: 120 },
    },
  })
    .jpeg()
    .toBuffer();

test('a large photograph is scaled to the latency budget', async () => {
  const out = await normaliseImage(await jpeg(2592, 1936));
  assert.equal(out.scaled, true);
  assert.equal(Math.max(out.width, out.height), VISION_MAX_EDGE_DEFAULT);
  assert.equal(out.originalWidth, 2592);
  assert.equal(out.originalHeight, 1936);
  assert.ok(
    Math.abs(out.width / out.height - 2592 / 1936) < 0.01,
    'the aspect ratio survives the resize',
  );
  assert.equal(out.mime, 'image/jpeg');
  assert.equal(out.warning, null);
});

test('a thumbnail is passed through and flagged, not silently accepted', async () => {
  const out = await normaliseImage(await jpeg(200, 113));
  assert.equal(out.scaled, false);
  assert.equal(out.width, 200);
  assert.match(out.warning, /below 320 px/);
  assert.match(out.warning, /200×113/);
});

test('a frame between the two limits is left alone', async () => {
  const out = await normaliseImage(await jpeg(800, 600));
  assert.equal(out.scaled, false);
  assert.equal(out.width, 800);
  assert.equal(out.warning, null);
});

test('the cap is configurable, and refuses nonsense', async () => {
  assert.equal(visionMaxEdge({ GEV_VISION_MAX_EDGE: '768' }), 768);
  assert.equal(
    visionMaxEdge({ GEV_VISION_MAX_EDGE: '10' }),
    VISION_MAX_EDGE_DEFAULT,
  );
  assert.equal(
    visionMaxEdge({ GEV_VISION_MAX_EDGE: 'abc' }),
    VISION_MAX_EDGE_DEFAULT,
  );
  assert.equal(visionMaxEdge({}), VISION_MAX_EDGE_DEFAULT);
  const out = await normaliseImage(await jpeg(2000, 1000), { maxEdge: 640 });
  assert.equal(Math.max(out.width, out.height), 640);
});

test('the useful-edge floor is a stated number, not a guess', () => {
  assert.equal(VISION_MIN_USEFUL_EDGE, 320);
});

test('an empty buffer is an error, not an empty answer', async () => {
  await assert.rejects(() => normaliseImage(Buffer.alloc(0)), /empty buffer/);
  await assert.rejects(
    () => normaliseImage(Buffer.from('not an image')),
    /image/,
  );
});
