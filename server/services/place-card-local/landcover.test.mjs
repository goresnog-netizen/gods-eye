import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import {
  TILE_SPAN_DEG,
  WORLDCOVER_CLASSES,
  classify,
  landCoverAt,
  landCoverClutterDb,
  landCoverStats,
  loadHeader,
  parseTiffHeader,
  tileIndexFor,
  tileNameFor,
} from './landcover.mjs';

const SCALE = 1 / 12000;
const WIDTH = 36000;
const TILE_PX = 1024;

/**
 * A WorldCover-shaped TIFF header, small enough to build in memory.
 *
 * The point is the tag layout, not the pixels: `parseTiffHeader` must find the
 * tile table, the pixel scale and the *north* edge, because the file name
 * carries the south-west corner and confusing the two silently returns sea.
 */
function makeTiff({
  width = WIDTH,
  height = WIDTH,
  tilePx = TILE_PX,
  tileCount = 1296,
  originLon = 138,
  originLat = -3,
  compression = 8,
} = {}) {
  const entries = 9;
  const ifdAt = 8;
  const afterIfd = ifdAt + 2 + entries * 12 + 2;
  const scaleAt = afterIfd;
  const tieAt = scaleAt + 3 * 8;
  const offsetsAt = tieAt + 6 * 8;
  const lengthsAt = offsetsAt + tileCount * 4;
  const buffer = Buffer.alloc(lengthsAt + tileCount * 4 + 8);

  buffer.write('II', 0, 'latin1');
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(ifdAt, 4);
  buffer.writeUInt16LE(entries, ifdAt);

  const entry = (i, tag, type, count, value) => {
    const at = ifdAt + 2 + i * 12;
    buffer.writeUInt16LE(tag, at);
    buffer.writeUInt16LE(type, at + 2);
    buffer.writeUInt32LE(count, at + 4);
    if (type === 3 && count === 1) buffer.writeUInt16LE(value, at + 8);
    else buffer.writeUInt32LE(value, at + 8);
  };
  entry(0, 256, 4, 1, width);
  entry(1, 257, 4, 1, height);
  entry(2, 259, 3, 1, compression);
  entry(3, 322, 4, 1, tilePx);
  entry(4, 323, 4, 1, tilePx);
  entry(5, 324, 4, tileCount, offsetsAt);
  entry(6, 325, 4, tileCount, lengthsAt);
  entry(7, 33550, 12, 3, scaleAt);
  entry(8, 33922, 12, 6, tieAt);

  buffer.writeDoubleLE(SCALE, scaleAt);
  buffer.writeDoubleLE(SCALE, scaleAt + 8);
  buffer.writeDoubleLE(0, scaleAt + 16);
  [0, 0, 0, originLon, originLat, 0].forEach((value, i) => {
    buffer.writeDoubleLE(value, tieAt + i * 8);
  });

  // Every tile claims the same byte range; the fetch stub ignores it.
  for (let i = 0; i < tileCount; i += 1) {
    buffer.writeUInt32LE(1024, offsetsAt + i * 4);
    buffer.writeUInt32LE(64, lengthsAt + i * 4);
  }
  return buffer;
}

/** A 1024² block where every pixel holds `code`. */
function blockOf(code) {
  return zlib.deflateSync(Buffer.alloc(TILE_PX * TILE_PX, code));
}

function stubFetch({ header, block }) {
  const calls = [];
  const impl = async (_url, { headers } = {}) => {
    const [start, end] = String(headers.Range)
      .replace('bytes=', '')
      .split('-')
      .map(Number);
    calls.push([start, end]);
    const body = start === 0 ? header : block;
    return {
      ok: true,
      status: 206,
      arrayBuffer: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

test('a tile is named by its south-west corner', () => {
  assert.equal(tileNameFor(-4.0975, 138.9517), 'S06E138');
  assert.equal(tileNameFor(-6, 138), 'S06E138', 'a tile owns its south edge');
  assert.equal(tileNameFor(-3, 138), 'S03E138', 'and gives its north away');
  assert.equal(tileNameFor(-5.999, 141), 'S06E141');
  assert.equal(tileNameFor(51.5, 3.2), 'N51E003');
  assert.equal(tileNameFor(-3.1, -60.5), 'S06W063');
  assert.equal(TILE_SPAN_DEG, 3);
});

test('the header carries the north edge, not the south', () => {
  const header = parseTiffHeader(makeTiff());
  assert.equal(header.width, 36000);
  assert.equal(header.tileWidth, 1024);
  assert.equal(header.across, 36);
  assert.equal(header.offsets.length, 1296);
  assert.equal(header.originLon, 138);
  assert.equal(header.originLat, -3, 'north edge of S06E138 is -3');
  assert.ok(Math.abs(header.pixelScale[0] - SCALE) < 1e-12);
});

test('a coordinate lands in the tile that holds it', () => {
  const header = parseTiffHeader(makeTiff());
  const wamena = tileIndexFor(header, -4.0975, 138.9517);
  assert.equal(wamena.col, 11);
  assert.equal(wamena.row, 12);
  assert.equal(wamena.index, 443);
  assert.equal(wamena.inside, true);

  const sea = tileIndexFor(header, -2.5, 138.95);
  assert.equal(sea.inside, false, 'north of the north edge is not this tile');
});

test('unknown class codes stay unknown instead of defaulting to open ground', () => {
  assert.equal(classify(10).key, 'tree-cover');
  assert.equal(classify(50).cluttered, true);
  assert.equal(classify(80).cluttered, false);
  const odd = classify(7);
  assert.equal(odd.key, 'unknown');
  assert.equal(odd.cluttered, false);
  assert.equal(odd.code, 7);
  assert.equal(Object.keys(WORLDCOVER_CLASSES).length, 12);
});

test('clutter is the flat allowance scaled by the cluttered share', () => {
  const forest = landCoverStats(Array(10).fill(classify(10)));
  assert.equal(forest.fraction, 1);
  assert.equal(landCoverClutterDb(forest, { flatDb: 8 }), 8);

  const water = landCoverStats(Array(10).fill(classify(80)));
  assert.equal(water.fraction, 0);
  assert.equal(landCoverClutterDb(water, { flatDb: 8 }), 0);

  const half = landCoverStats([
    ...Array(5).fill(classify(10)),
    ...Array(5).fill(classify(30)),
  ]);
  assert.equal(half.fraction, 0.5);
  assert.equal(landCoverClutterDb(half, { flatDb: 8 }), 4);
  assert.equal(half.dominant, 'tree-cover');

  assert.equal(landCoverClutterDb(half, { flatDb: 40, maxDb: 10 }), 10);
  assert.equal(landCoverClutterDb(landCoverStats([]), { flatDb: 8 }), 0);
});

test('landCoverAt reads the pixel under the coordinate, and caches it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gev-wc-'));
  try {
    const header = makeTiff();
    const block = blockOf(10);
    const fetchImpl = stubFetch({ header, block });

    const first = await landCoverAt(-4.0975, 138.9517, { fetchImpl, dir });
    assert.equal(first.code, 10);
    assert.equal(first.key, 'tree-cover');
    assert.equal(first.tile, 'S06E138');
    // One header request plus one tile request — not a 5 MB download.
    assert.equal(fetchImpl.calls.length, 2);

    const second = await landCoverAt(-4.1, 138.96, { fetchImpl, dir });
    assert.equal(second.code, 10);
    assert.equal(
      fetchImpl.calls.length,
      2,
      'a second lookup in the same block reads memory, not the network',
    );

    const outside = await landCoverAt(-2.5, 138.95, { fetchImpl, dir });
    assert.equal(outside, null, 'outside the grid is no observation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a header is cached on disk and reused', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gev-wc-'));
  try {
    const header = makeTiff();
    const fetchImpl = stubFetch({ header, block: blockOf(30) });
    const parsed = await loadHeader('S06E138', { fetchImpl, dir });
    assert.equal(parsed.width, 36000);
    const again = await loadHeader('S06E138', {
      fetchImpl: stubFetch({ header, block: blockOf(30) }),
      dir,
    });
    assert.deepEqual(again.offsets, parsed.offsets);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
