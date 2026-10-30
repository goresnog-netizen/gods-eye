#!/usr/bin/env node
/**
 * Test for local Place Card module (no external calls).
 */

import { buildPlaceCard } from './build-place-card.mjs';
import { resolvePlace } from './resolve-place.mjs';
import { fetchStreetPhoto } from './fetch-street-photo.mjs';
import { bboxAround } from './build-place-card.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('=== Place Card Local Tests ===\n');

test('resolvePlace exact match (Jakarta)', async () => {
  const p = await resolvePlace('jakarta');
  if (p.name !== 'Jakarta, Indonesia') throw new Error(`name=${p.name}`);
  if (p.lat !== -6.2) throw new Error(`lat=${p.lat}`);
});

test('resolvePlace partial match (pap)', async () => {
  const p = await resolvePlace('pap');
  if (!p.name.includes('Papua')) throw new Error(`name=${p.name}`);
});

test('resolvePlace fallback for unknown', async () => {
  const p = await resolvePlace('zzzzzunknown');
  if (!p) throw new Error('null result');
});

test('fetchStreetPhoto returns available', async () => {
  const place = { name: 'Test', lat: -6.2, lon: 106.8167 };
  const photo = await fetchStreetPhoto(place);
  if (!photo.available) throw new Error('not available');
  if (photo.provider !== 'local-mock') throw new Error(`provider=${photo.provider}`);
});

test('bboxAround computes valid bounds', () => {
  const bbox = bboxAround(-6.2, 106.8167, 25);
  if (bbox.south >= bbox.north) throw new Error('invalid lat bounds');
  if (bbox.west >= bbox.east) throw new Error('invalid lon bounds');
});

test('buildPlaceCard end-to-end', async () => {
  const card = await buildPlaceCard('Jakarta');
  if (card.place.name !== 'Jakarta, Indonesia') throw new Error(`name=${card.place.name}`);
  if (!card.photo.available) throw new Error('photo not available');
  if (card.source !== 'local-only') throw new Error(`source=${card.source}`);
  if (!card.intent.tool) throw new Error('no intent tool');
});

test('buildPlaceCard for Papua', async () => {
  const card = await buildPlaceCard('Papua');
  if (card.place.name !== 'Papua, Indonesia') throw new Error(`name=${card.place.name}`);
  if (card.place.lat !== -4.5326) throw new Error(`lat=${card.place.lat}`);
});

async function runAll() {
  console.log('Running tests...\n');
  // Re-run async tests
  const tests = [
    ['resolvePlace exact match (Jakarta)', async () => {
      const p = await resolvePlace('jakarta');
      if (p.name !== 'Jakarta, Indonesia') throw new Error(`name=${p.name}`);
      if (p.lat !== -6.2) throw new Error(`lat=${p.lat}`);
    }],
    ['resolvePlace partial match (pap)', async () => {
      const p = await resolvePlace('pap');
      if (!p.name.includes('Papua')) throw new Error(`name=${p.name}`);
    }],
    ['resolvePlace fallback for unknown', async () => {
      const p = await resolvePlace('zzzzzunknown');
      if (!p) throw new Error('null result');
    }],
    ['fetchStreetPhoto returns available', async () => {
      const place = { name: 'Test', lat: -6.2, lon: 106.8167 };
      const photo = await fetchStreetPhoto(place);
      if (!photo.available) throw new Error('not available');
      if (photo.provider !== 'local-mock') throw new Error(`provider=${photo.provider}`);
    }],
    ['buildPlaceCard end-to-end', async () => {
      const card = await buildPlaceCard('Jakarta');
      if (card.place.name !== 'Jakarta, Indonesia') throw new Error(`name=${card.place.name}`);
      if (!card.photo.available) throw new Error('photo not available');
      if (card.source !== 'local-only') throw new Error(`source=${card.source}`);
      if (!card.intent.tool) throw new Error('no intent tool');
    }],
    ['buildPlaceCard for Papua', async () => {
      const card = await buildPlaceCard('Papua');
      if (card.place.name !== 'Papua, Indonesia') throw new Error(`name=${card.place.name}`);
      if (card.place.lat !== -4.5326) throw new Error(`lat=${card.place.lat}`);
    }],
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();