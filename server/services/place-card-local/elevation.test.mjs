import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  decodeTerrarium,
  lonLatToTile,
  metresPerPixel,
  prefetchArea,
  sampleTile,
  tileFor,
} from './elevation.mjs';

// The loader writes every tile it downloads to the cache directory. Pointing
// it at a temporary one keeps a flat test tile out of the real DEM cache,
// where it would silently flatten Agats for the next real viewshed.
process.env.GEV_DEM_DIR = path.join(os.tmpdir(), `gev-dem-test-${process.pid}`);

test('a coordinate maps to the right tile and pixel', () => {
  // Null island at zoom 0 is the centre of the single tile.
  const origin = tileFor(0, 0, 0);
  assert.deepEqual(
    {
      x: origin.x,
      y: origin.y,
      px: Math.round(origin.px),
      py: Math.round(origin.py),
    },
    { x: 0, y: 0, px: 128, py: 128 },
  );
  // Jayapura at zoom 11 lands in a tile east of 140°.
  const jayapura = tileFor(-2.5337, 140.7175, 11);
  assert.equal(jayapura.z, 11);
  assert.ok(jayapura.x > 1800 && jayapura.x < 1900, `x=${jayapura.x}`);
  assert.ok(jayapura.px >= 0 && jayapura.px < 256);
  assert.ok(jayapura.py >= 0 && jayapura.py < 256);
});

test('the tile grid gets finer with zoom', () => {
  const coarse = lonLatToTile(0, 0, 0);
  const fine = lonLatToTile(0, 0, 11);
  assert.equal(coarse.size, 1);
  assert.equal(fine.size, 2048);
  assert.ok(metresPerPixel(0, 0) > 100_000);
  assert.ok(metresPerPixel(0, 11) < 100, 'about 76 m per pixel at the equator');
  assert.ok(
    metresPerPixel(-4, 11) < metresPerPixel(0, 11),
    'a pixel covers less ground away from the equator',
  );
});

test('a terrarium PNG decodes to metres', async () => {
  const sharp = (await import('sharp')).default;
  // Two pixels: 0 m and 1650 m, encoded the way terrarium does.
  const encode = (height) => {
    const value = Math.round(height + 32768);
    return [Math.floor(value / 256), value % 256, 0];
  };
  const raw = Buffer.from([...encode(0), ...encode(1650)]);
  const png = await sharp(raw, { raw: { width: 2, height: 1, channels: 3 } })
    .png()
    .toBuffer();

  const tile = await decodeTerrarium(png);
  assert.equal(tile.width, 2);
  assert.equal(tile.height, 1);
  assert.equal(Math.round(tile.pixels[0]), 0);
  assert.equal(Math.round(tile.pixels[1]), 1650);
});

test('bilinear sampling interpolates between pixels', () => {
  const tile = {
    width: 2,
    height: 2,
    pixels: new Float32Array([0, 10, 20, 30]),
  };
  assert.equal(sampleTile(tile, 0, 0), 0);
  assert.equal(sampleTile(tile, 0.5, 0.5), 15);
  // The sampler clamps just inside the last pixel, so the corner is 29.99,
  // not 30 — close enough for terrain, exact enough to test.
  assert.ok(Math.abs(sampleTile(tile, 1, 1) - 30) < 0.1);
  assert.ok(
    Math.abs(sampleTile(tile, 99, 99) - 30) < 0.1,
    'out of range clamps',
  );
});

test('a negative elevation survives the encoding', async () => {
  const sharp = (await import('sharp')).default;
  // Death Valley is below sea level; the format must not clip it to zero.
  const value = Math.round(-86 + 32768);
  const raw = Buffer.from([Math.floor(value / 256), value % 256, 0]);
  const png = await sharp(raw, { raw: { width: 1, height: 1, channels: 3 } })
    .png()
    .toBuffer();
  const tile = await decodeTerrarium(png);
  assert.equal(Math.round(tile.pixels[0]), -86);
});

test('a prefetch asks for the block of tiles a radius touches, once each', async () => {
  // A 20 km viewshed at zoom 11 spans 3x3 tiles: 40 km of ground across.
  const sharp = (await import('sharp')).default;
  const flatTile = await sharp(Buffer.alloc(256 * 256 * 3, 0), {
    raw: { width: 256, height: 256, channels: 3 },
  })
    .png()
    .toBuffer();
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return { ok: true, arrayBuffer: async () => flatTile };
  };
  const tiles = await prefetchArea(-6.2, 138.6, 20, { fetchImpl });
  assert.equal(tiles, 9, 'a 40 km box is nine 20 km tiles');
  assert.equal(new Set(seen).size, 9, 'each tile is asked for once');
  // The second call is free: everything is in memory.
  const again = await prefetchArea(-6.2, 138.6, 20, { fetchImpl });
  assert.equal(again, 9);
  assert.equal(seen.length, 9, 'no tile was fetched twice');
});

test('a prefetch with a silly radius does nothing', async () => {
  assert.equal(await prefetchArea(0, 0, 0), 0);
  assert.equal(await prefetchArea(0, 0, -5), 0);
  assert.equal(await prefetchArea(0, 0, Number.NaN), 0);
});
