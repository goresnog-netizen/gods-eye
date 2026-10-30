import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.GEV_TILE_DIR = path.join(
  os.tmpdir(),
  `gev-tiles-test-${process.pid}`,
);

const {
  fetchImageryTile,
  imageryCredit,
  metresPerPixel,
  remoteElevation,
  tileIndex,
  tileUrl,
  verifyHeight,
} = await import('./imagery.mjs');

/** A 1×1 PNG is enough: the module only forwards the bytes it is given. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fakeFetch(body) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    if (body instanceof Error) throw body;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

test('a coordinate maps to the Esri tile that contains it', () => {
  const { x, y, zoom } = tileIndex(-2.5337, 140.7175, 15);
  assert.equal(zoom, 15);
  assert.ok(Number.isInteger(x) && Number.isInteger(y));
  // Round-tripping through the tile's own bounds must contain the point.
  const n = 2 ** 15;
  const lonWest = (x / n) * 360 - 180;
  const lonEast = ((x + 1) / n) * 360 - 180;
  assert.ok(
    lonWest <= 140.7175 && 140.7175 < lonEast,
    'longitude inside the tile',
  );
  assert.match(tileUrl(-2.5337, 140.7175, 15), /\/tile\/15\/\d+\/\d+$/);
});

test('ground resolution doubles with every zoom level', () => {
  const near = metresPerPixel(-2.5337, 15);
  const far = metresPerPixel(-2.5337, 14);
  assert.ok(Math.abs(near * 2 - far) < 0.01, 'one zoom is twice the ground');
  assert.ok(
    metresPerPixel(0, 15) > metresPerPixel(-60, 15),
    'wider near the equator',
  );
});

test('a fetched tile is cached and not fetched twice', async () => {
  const fetchImpl = fakeFetch(TINY_PNG);
  const first = await fetchImageryTile(-2.5337, 140.7175, 12, { fetchImpl });
  assert.ok(first, 'the tile came back');
  assert.equal(first.bytes.length, TINY_PNG.length);
  assert.equal(first.source, 'esri-world-imagery');
  assert.equal(fetchImpl.calls.length, 1);

  const second = await fetchImageryTile(-2.5337, 140.7175, 12, { fetchImpl });
  assert.ok(second, 'the second call answers from disk');
  assert.equal(fetchImpl.calls.length, 1, 'no second network request');
});

test('a coordinate outside the world is refused, not guessed', async () => {
  assert.equal(
    await fetchImageryTile(Number.NaN, 140, 12, {
      fetchImpl: fakeFetch(TINY_PNG),
    }),
    null,
  );
  assert.equal(
    await fetchImageryTile(-2.5, 999, 12, { fetchImpl: fakeFetch(TINY_PNG) }),
    null,
  );
});

test('zoom is clamped to what Esri serves', async () => {
  const fetchImpl = fakeFetch(TINY_PNG);
  const tile = await fetchImageryTile(-2.5337, 140.7175, 99, { fetchImpl });
  assert.equal(tile.zoom, 19, '19 is the deepest Esri goes');
});

test('a failing tile returns null rather than a broken image', async () => {
  // A coordinate no earlier test cached, so the failure is the network's and
  // not a cache hit.
  const impl = async () => ({ ok: false, status: 404 });
  assert.equal(
    await fetchImageryTile(-8.4932, 140.4018, 13, { fetchImpl: impl }),
    null,
  );
});

test('the remote elevation answers with the Copernicus height', async () => {
  const fetchImpl = fakeFetch({ elevation: [1654] });
  assert.equal(await remoteElevation(-4.1, 138.95, { fetchImpl }), 1654);
  assert.match(
    fetchImpl.calls[0],
    /open-meteo\.com.*elevation.*-4\.1.*138\.95/,
  );
});

test('two DEMs that agree make the height trustworthy', async () => {
  const fetchImpl = fakeFetch({ elevation: [1654] });
  const check = await verifyHeight(-4.1, 138.95, { fetchImpl });
  // Wamena: the local Terrarium tile reads ~1658 m.
  assert.equal(check.ok, true);
  assert.equal(check.verdict, 'agree');
  assert.ok(check.deltaM <= 25, `delta ${check.deltaM} m`);
  assert.match(check.detail, /Two independent DEMs agree/);
});

test('a large disagreement is reported, not averaged away', async () => {
  const fetchImpl = fakeFetch({ elevation: [900] });
  const check = await verifyHeight(-4.1, 138.95, { fetchImpl });
  assert.equal(check.ok, false, 'the answer is not silently trusted');
  assert.equal(check.verdict, 'disagree');
  assert.match(check.detail, /Treat the height as unknown/);
  assert.equal(
    check.localM > 1600,
    true,
    'the local reading is still reported',
  );
});

test('a height with only one source says so', async () => {
  const check = await verifyHeight(-4.1, 138.95, {
    fetchImpl: async () => ({ ok: false }),
  });
  assert.equal(check.ok, false);
  assert.equal(check.verdict, 'one-source-only');
  assert.match(check.detail, /Only the local DEM/);
});

test('the credit travels with the module, not as an option', () => {
  const credit = imageryCredit();
  assert.match(credit.text, /Esri/);
  assert.match(credit.text, /Copernicus/);
  assert.ok(credit.sources.includes('esri-world-imagery'));
});
