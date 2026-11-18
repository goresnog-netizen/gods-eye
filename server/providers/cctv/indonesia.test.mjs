import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_INDONESIA_SOURCES_FILE,
  indonesiaRowToSource,
  isLikelyIndonesiaCoordinate,
  loadIndonesiaSourcesFromCatalog,
} from './indonesia.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const ROW = {
  id: 'mly-1036657995215135',
  name: 'Sorong · Mapillary image 1036657995215135',
  city: 'Sorong, Papua Barat Daya',
  cityId: 'id-sorong',
  provider: 'Mapillary',
  lat: -0.880606,
  lon: 131.260659,
  headingDeg: 42,
  headingConfidence: 'high',
  fovDeg: 70,
  rangeM: 90,
  mountHeightM: 1.8,
  feedType: 'image',
  url: 'https://scontent-sin6-3.xx.fbcdn.net/m1/v/t6/photo.jpg',
  snapshotUrl: 'https://scontent-sin6-3.xx.fbcdn.net/m1/v/t6/photo.jpg',
  license: 'CC BY-SA 4.0',
  credit: '© Mapillary Contributors',
  sourceKind: 'mapillary-street-image',
  code: 'MLY-5135',
};

function silence(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
}

test('coordinate guard keeps the archipelago, rejects other regions', () => {
  assert.equal(isLikelyIndonesiaCoordinate(-2.5337, 140.7175), true);
  assert.equal(isLikelyIndonesiaCoordinate(-0.8806, 131.2607), true);
  assert.equal(isLikelyIndonesiaCoordinate(59.437, 24.753), false); // Tallinn
  assert.equal(isLikelyIndonesiaCoordinate(NaN, 140), false);
});

test('a verified row becomes a source with attribution intact', () => {
  const source = indonesiaRowToSource(ROW);
  assert.equal(source.id, 'mly-1036657995215135');
  assert.equal(source.city, 'Sorong, Papua Barat Daya');
  assert.equal(source.feedType, 'image');
  assert.equal(source.snapshotUrl, ROW.snapshotUrl);
  assert.match(source.credit, /Mapillary Contributors/);
  assert.equal(source.sourceKind, 'mapillary-street-image');
});

test('rows without a real HTTPS feed or with bad coordinates are dropped', () => {
  assert.equal(indonesiaRowToSource(null), null);
  assert.equal(indonesiaRowToSource({ ...ROW, id: '' }), null);
  assert.equal(indonesiaRowToSource({ ...ROW, lat: 59.4, lon: 24.7 }), null);
  assert.equal(indonesiaRowToSource({ ...ROW, url: 'http://example.com/x.jpg' }), null);
  assert.equal(indonesiaRowToSource({ ...ROW, url: '' }), null);
});

test('a stream the sweep could not open is never pinned', () => {
  const offline = { ...ROW, feedType: 'hls', online: false };
  assert.equal(indonesiaRowToSource(offline), null);
  // Legacy rows carry the verdict in the note instead of a flag.
  assert.equal(
    indonesiaRowToSource({
      ...ROW,
      feedType: 'hls',
      credit: 'Offline at sweep 2026-11-03T13:54:39.977Z',
    }),
    null,
  );
  assert.ok(indonesiaRowToSource({ ...ROW, feedType: 'hls', online: true }));
});

test('the committed snapshot loads the verified street imagery', (t) => {
  silence(t);
  const previousCap = process.env.CCTV_INDONESIA_MAX_SOURCES;
  const previousFile = process.env.CCTV_INDONESIA_SOURCES_FILE;
  const previousAtcs = process.env.CCTV_INDONESIA_ATCS;
  delete process.env.CCTV_INDONESIA_MAX_SOURCES;
  delete process.env.CCTV_INDONESIA_SOURCES_FILE;
  delete process.env.CCTV_INDONESIA_ATCS;
  try {
    const sources = loadIndonesiaSourcesFromCatalog({ sourceRoot: ROOT });
    assert.ok(sources.length > 100, `expected a full catalog, got ${sources.length}`);
    assert.ok(
      sources.every((source) => !/^offline at sweep/i.test(source.credit)),
      'offline ATCS streams are filtered out',
    );
    const kinds = new Set(sources.map((source) => source.sourceKind));
    assert.ok(kinds.has('mapillary-street-image'));
    assert.ok(
      !kinds.has('kartaview-street-photo'),
      'KartaView is excluded: its image CDN is dead',
    );
    assert.ok(
      !kinds.has('atcs-id'),
      'live ATCS is opt-in because the proxy cannot verify its TLS chain',
    );

    // Opting in brings the live streams back without touching the snapshot.
    process.env.CCTV_INDONESIA_ATCS = '1';
    const withAtcs = loadIndonesiaSourcesFromCatalog({ sourceRoot: ROOT });
    assert.ok(withAtcs.some((source) => source.sourceKind === 'atcs-id'));
    assert.ok(withAtcs.length > sources.length);
    assert.ok(
      sources.every((source) => /^https:\/\//.test(source.url)),
      'every source has a real HTTPS feed',
    );
    assert.ok(
      sources.every((source) => isLikelyIndonesiaCoordinate(source.lat, source.lon)),
      'every source is inside Indonesia',
    );
    assert.equal(DEFAULT_INDONESIA_SOURCES_FILE, 'config/cctv_sources.indonesia.json');
  } finally {
    if (previousCap === undefined) delete process.env.CCTV_INDONESIA_MAX_SOURCES;
    else process.env.CCTV_INDONESIA_MAX_SOURCES = previousCap;
    if (previousFile === undefined) delete process.env.CCTV_INDONESIA_SOURCES_FILE;
    else process.env.CCTV_INDONESIA_SOURCES_FILE = previousFile;
    if (previousAtcs === undefined) delete process.env.CCTV_INDONESIA_ATCS;
    else process.env.CCTV_INDONESIA_ATCS = previousAtcs;
  }
});

test('CCTV_INDONESIA_SOURCES_FILE override and cap are honoured', (t) => {
  silence(t);
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'gev-indonesia-')),
    'cameras.json',
  );
  fs.writeFileSync(
    tmp,
    JSON.stringify([
      ROW,
      { ...ROW, id: 'mly-5678', lat: -2.5337, lon: 140.7175 },
      { ...ROW, id: 'mly-9999', lat: -8.4667, lon: 140.3333 },
    ]),
  );
  const previousFile = process.env.CCTV_INDONESIA_SOURCES_FILE;
  const previousCap = process.env.CCTV_INDONESIA_MAX_SOURCES;
  process.env.CCTV_INDONESIA_SOURCES_FILE = tmp;
  process.env.CCTV_INDONESIA_MAX_SOURCES = '2';
  try {
    const sources = loadIndonesiaSourcesFromCatalog({ sourceRoot: ROOT });
    assert.equal(sources.length, 2);
    assert.equal(new Set(sources.map((source) => source.id)).size, 2);
  } finally {
    if (previousFile === undefined) delete process.env.CCTV_INDONESIA_SOURCES_FILE;
    else process.env.CCTV_INDONESIA_SOURCES_FILE = previousFile;
    if (previousCap === undefined) delete process.env.CCTV_INDONESIA_MAX_SOURCES;
    else process.env.CCTV_INDONESIA_MAX_SOURCES = previousCap;
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
});
