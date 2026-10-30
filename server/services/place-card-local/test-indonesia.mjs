#!/usr/bin/env node
/**
 * Test suite for Indonesia/Papua modules (local-only).
 */

import { buildPlaceCard } from './build-place-card.mjs';
import { resolvePlace } from './resolve-place.mjs';
import { fetchLocalCctv } from './fetch-cctv-local.mjs';
import { resolveTarget, getTargetsByRegion } from './target-tracker.mjs';
import { generateVisionOutput, getArea, PAPUA_AREAS } from './vision-papua.mjs';
import { analyzeImage } from './vision-real.mjs';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function runAll() {
  console.log('=== Indonesia/Papua Module Tests ===\n');

  // --- resolve-place ---
  console.log('--- resolve-place ---');
  await test('resolvePlace exact Jakarta', async () => {
    const p = await resolvePlace('jakarta');
    if (p.name !== 'Jakarta, Indonesia') throw new Error(`name=${p.name}`);
    if (p.lat !== -6.2) throw new Error(`lat=${p.lat}`);
  });
  await test('resolvePlace partial pap', async () => {
    const p = await resolvePlace('pap');
    if (!p.name.includes('Papua')) throw new Error(`name=${p.name}`);
  });
  await test('resolvePlace Papua city', async () => {
    const p = await resolvePlace('jayapura');
    if (!p.name.includes('Jayapura')) throw new Error(`name=${p.name}`);
  });
  await test('resolvePlace unknown fallback', async () => {
    const p = await resolvePlace('zzzzzunknown');
    if (!p) throw new Error('null result');
  });

  // --- build-place-card ---
  console.log('\n--- build-place-card ---');
  await test('buildPlaceCard Jakarta', async () => {
    const card = await buildPlaceCard('Jakarta');
    if (card.place.name !== 'Jakarta, Indonesia') throw new Error(`name=${card.place.name}`);
    if (!card.photo.available) throw new Error('photo not available');
    if (card.source !== 'local-only') throw new Error(`source=${card.source}`);
    if (!card.intent.tool) throw new Error('no intent tool');
  });
  await test('buildPlaceCard Papua', async () => {
    const card = await buildPlaceCard('Papua');
    if (card.place.name !== 'Papua, Indonesia') throw new Error(`name=${card.place.name}`);
  });

  // --- fetch-cctv ---
  console.log('\n--- fetch-cctv-local ---');
  await test('fetchCctvNearby Jakarta', async () => {
    const cctv = await fetchLocalCctv({lat: -6.2, lon: 106.8167}, 50);
    if (!cctv.inside) throw new Error('no inside');
    if (cctv.inside.length === 0) throw new Error('empty');
  });
  await test('fetchCctvNearby Papua', async () => {
    const cctv = await fetchLocalCctv({lat: -4.5326, lon: 140.5066}, 100);
    if (!cctv.inside) throw new Error('no inside');
  });

  // --- target-tracker ---
  console.log('\n--- target-tracker ---');
  await test('resolveTarget by name', async () => {
    const t = await resolveTarget('Target Papua 1');
    if (!t.target) throw new Error('no target');
    if (t.target.id !== 't-001') throw new Error(`id=${t.target.id}`);
  });
  await test('resolveTarget by phone', async () => {
    const t = await resolveTarget('+62-812-3456-7890');
    if (!t.target) throw new Error('no target');
  });
  await test('resolveTarget unknown', async () => {
    const t = await resolveTarget('nonexistent-target-xyz');
    if (t.target) throw new Error('should be null');
  });
  await test('getTargetsByRegion papua', () => {
    const r = getTargetsByRegion('papua');
    if (!r) throw new Error('null result');
  });

  // --- vision-papua ---
  console.log('\n--- vision-papua ---');
  await test('generateVisionOutput area', () => {
    const area = PAPUA_AREAS[0];
    const v = generateVisionOutput(area);
    if (!v.area) throw new Error('no area');
    if (!Array.isArray(v.people)) throw new Error('no people');
    if (!v.summary) throw new Error('no summary');
  });
  await test('getArea by name', () => {
    const a = getArea('Tolikara');
    if (!a) throw new Error('null');
    if (!a.name.includes('Tolikara')) throw new Error(`name=${a.name}`);
  });
  await test('PAPUA_AREAS count', () => {
    if (PAPUA_AREAS.length !== 10) throw new Error(`count=${PAPUA_AREAS.length}`);
  });

  // --- dashboard JSON ---
  console.log('\n--- dashboard JSON ---');
  await test('dashboard-indonesia.json exists', () => {
    const d = JSON.parse(readFileSync(resolve('src/data/place-card-results/dashboard-indonesia.json'), 'utf-8'));
    if (!d.summary) throw new Error('no summary');
    if (d.summary.cities !== 10) throw new Error(`cities=${d.summary.cities}`);
    if (d.summary.newsItems !== 127) throw new Error(`news=${d.summary.newsItems}`);
    if (d.summary.targets !== 8) throw new Error(`targets=${d.summary.targets}`);
    if (d.summary.visionAreas !== 10) throw new Error(`vision=${d.summary.visionAreas}`);
    if (d.summary.cctvCameras !== 21) throw new Error(`cctv=${d.summary.cctvCameras}`);
  });
  await test('indonesia-news.json exists', () => {
    const d = JSON.parse(readFileSync(resolve('src/data/place-card-results/indonesia-news.json'), 'utf-8'));
    if (!d.count) throw new Error('no count');
    if (!Array.isArray(d.items)) throw new Error('no items');
  });
  await test('papua-targets.json exists', () => {
    const d = JSON.parse(readFileSync(resolve('src/data/place-card-results/papua-targets.json'), 'utf-8'));
    if (!d.count) throw new Error('no count');
  });
  await test('vision-papua.json exists', () => {
    const d = JSON.parse(readFileSync(resolve('src/data/place-card-results/vision-papua.json'), 'utf-8'));
    if (!Array.isArray(d)) throw new Error('not array');
    if (d.length !== 10) throw new Error(`length=${d.length}`);
  });

  // --- vision-real (unit) ---
  console.log('\n--- vision-real (unit) ---');
  await test('analyzeImage is function', () => {
    if (typeof analyzeImage !== 'function') throw new Error('not function');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAll().catch((e) => {
  console.error(`GAGAL: ${e?.message || e}`);
  process.exit(1);
});