import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCENE_PROMPT,
  clamp01,
  extractJson,
  normalizeBox,
  normalizeResult,
  parseSceneReply,
} from './vision-contract.js';

test('extractJson finds the object in prose, in a fence, and not at all', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a":2}\n```\nthanks'), {
    a: 2,
  });
  assert.deepEqual(extractJson('{"a":{"b":3}} trailing'), { a: { b: 3 } });
  assert.equal(extractJson('no json here'), null);
});

test('clamp01 keeps a confidence inside 0..1', () => {
  assert.equal(clamp01(0.8), 0.8);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(9), 1);
  assert.equal(clamp01('x'), 0);
});

test('a pixel box with an image size becomes x, y, width, height', () => {
  const normalized = normalizeBox([184, 246, 275, 590], [1024, 768]);
  assert.equal(normalized.space, 'pixels');
  assert.ok(Math.abs(normalized.box[0] - 184 / 1024) < 0.001);
  assert.ok(Math.abs(normalized.box[1] - 246 / 768) < 0.001);
  assert.ok(Math.abs(normalized.box[2] - 91 / 1024) < 0.001);
  assert.ok(Math.abs(normalized.box[3] - 344 / 768) < 0.001);
});

test('a box that is already normalised keeps its own space', () => {
  const normalized = normalizeBox([0.1, 0.2, 0.3, 0.4], [1024, 768]);
  assert.equal(normalized.space, 'normalized');
  assert.deepEqual(normalized.box, [0.1, 0.2, 0.3, 0.4]);
});

test('a box without an image size is flagged, never silently correct', () => {
  const normalized = normalizeBox([184, 246, 275, 590], null);
  assert.equal(normalized.space, 'unverified');
  assert.equal(normalized.box.length, 4);
  assert.equal(normalizeBox([1, 2], null), null);
  assert.equal(normalizeBox(['x', 2, 3, 4], [10, 10]), null);
});

test('normalizeResult keeps people, what they hold and their activity', () => {
  const result = normalizeResult({
    image_size: [1024, 768],
    scene: 'A street',
    people: [
      {
        bbox: [184, 246, 275, 590],
        holding: ['phone'],
        activity: 'standing',
        confidence: 0.8,
      },
    ],
    vehicles: [{ bbox: [450, 445, 614, 538], type: 'bicycle', confidence: 0.7 }],
    notes: 'rainy',
  });
  assert.equal(result.people.length, 1);
  assert.deepEqual(result.people[0].holding, ['phone']);
  assert.equal(result.people[0].activity, 'standing');
  assert.equal(result.people[0].confidence, 0.8);
  assert.equal(result.people[0].bboxSpace, 'pixels');
  assert.equal(result.vehicles[0].type, 'bicycle');
  assert.equal(result.scene, 'A street');
  assert.equal(result.notes, 'rainy');
});

test('parseSceneReply keeps a prose answer as the note', () => {
  const prose = parseSceneReply('I cannot make out anything here.');
  assert.equal(prose.parsed, false);
  assert.equal(prose.people.length, 0);
  assert.match(prose.notes, /cannot make out/);
});

test('the scene prompt asks for pixel corners and the image size', () => {
  assert.match(SCENE_PROMPT, /pixel corners/);
  assert.match(SCENE_PROMPT, /image pixel size/);
});
