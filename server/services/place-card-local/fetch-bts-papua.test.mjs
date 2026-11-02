import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { PAPUA_BBOX } from './import-bts.mjs';
import {
  boxAreaKm2,
  boxFits,
  cellsToSites,
  collectCellsByProbe,
  dedupeCells,
  defaultCentres,
  nameSites,
  probeBoxes,
  rebuildSites,
  loadState,
  readExportText,
  resolveDownloadUrl,
  saveState,
  siteLabel,
  sitesFromExport,
  MAX_BOX_M2,
  normalizeBoxes,
  normalizeBoxKey,
} from './fetch-bts-papua.mjs';

const bboxParam = (box) => [box.south, box.west, box.north, box.east].join(',');

function cell(
  lat,
  lon,
  cellId,
  { lac = 100, mnc = 10, radio = 'LTE', range = 5000, samples = 20 } = {},
) {
  return {
    lat,
    lon,
    mcc: 510,
    mnc,
    lac,
    cellId,
    rangeM: range,
    rangeKm: range / 1000,
    samples,
    radio,
    tech: radio === 'GSM' ? '2G' : '4G',
  };
}

/** A stand-in for `getInArea`, keyed by the box it is asked about. */
function fakeApi({ counts = {}, cells = {} } = {}) {
  const calls = [];
  const impl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    const box = parsed.searchParams.get('BBOX');
    const all = cells[box] || [];
    const offset = Number(parsed.searchParams.get('offset') || 0);
    const limit = Number(parsed.searchParams.get('limit') || 50);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          count: counts[box] ?? all.length,
          cells: all.slice(offset, offset + limit).map((entry) => ({
            lat: entry.lat,
            lon: entry.lon,
            mcc: entry.mcc,
            mnc: entry.mnc,
            lac: entry.lac,
            cellid: entry.cellId,
            range: entry.rangeM,
            samples: entry.samples,
            radio: entry.radio,
          })),
        }),
    };
  };
  impl.calls = calls;
  return impl;
}

test('the API box ceiling is 4 km², so a degree-sized box is refused', () => {
  assert.equal(MAX_BOX_M2, 4_000_000);
  const degree = { south: -2.6, west: 140.7, north: -1.6, east: 141.7 };
  assert.ok(boxAreaKm2(degree) > 10_000, 'a 1° box is ~12,000 km²');
  assert.equal(
    boxFits(degree),
    false,
    'this is why the tile sweep could never work',
  );
  const small = { south: -2.6, west: 140.7, north: -2.5838, east: 140.7162 };
  assert.ok(boxFits(small), `${boxAreaKm2(small).toFixed(2)} km² fits`);
});

test('probe boxes tile a square around the centre and all fit the API rule', () => {
  const boxes = probeBoxes(
    { id: 'wamena', lat: -4.1, lon: 138.95 },
    { radiusKm: 3, boxKm: 1.8 },
  );
  assert.equal(boxes.length, 16, 'ceil(6 / 1.8)² = 4 × 4');
  assert.equal(new Set(boxes.map((box) => box.id)).size, 16, 'ids are unique');
  for (const box of boxes) {
    assert.ok(boxFits(box), `${box.id} is ${boxAreaKm2(box).toFixed(2)} km²`);
    assert.ok(box.north > box.south && box.east > box.west);
  }
  const lats = boxes.map((box) => (box.south + box.north) / 2);
  const lons = boxes.map((box) => (box.west + box.east) / 2);
  assert.ok(Math.min(...lats) < -4.1 && Math.max(...lats) > -4.1);
  assert.ok(Math.min(...lons) < 138.95 && Math.max(...lons) > 138.95);
});

test('the default probe targets are the regency capitals the console watches', () => {
  const centres = defaultCentres();
  assert.ok(centres.length >= 40);
  for (const centre of centres) {
    assert.ok(centre.id && centre.label);
    assert.ok(Number.isFinite(centre.lat) && Number.isFinite(centre.lon));
  }
});

test('an empty box costs one credit and yields nothing', async () => {
  const boxes = probeBoxes(
    { id: 'x', lat: -4.1, lon: 138.95 },
    { radiusKm: 0, boxKm: 1.8 },
  );
  const fetchImpl = fakeApi();
  const result = await collectCellsByProbe({ key: 'k', boxes, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.cells.length, 0);
  assert.equal(result.requests, 1);
});

test('a dense box is paged until every cell is read', async () => {
  const box = {
    south: -2.6,
    west: 140.7,
    north: -2.5838,
    east: 140.7162,
    id: 'a',
  };
  const cells = Array.from({ length: 120 }, (_, index) =>
    cell(-2.59 + index * 0.0001, 140.71, 1000 + index),
  );
  const fetchImpl = fakeApi({
    counts: { [bboxParam(box)]: 120 },
    cells: { [bboxParam(box)]: cells },
  });
  const result = await collectCellsByProbe({
    key: 'k',
    boxes: [box],
    fetchImpl,
  });
  assert.equal(result.cells.length, 120);
  assert.equal(result.requests, 3, '50 + 50 + 20');
  assert.deepEqual(
    fetchImpl.calls.map((url) => url.searchParams.get('offset')),
    ['0', '50', '100'],
  );
});

test('the budget is a hard stop, and what is left is reported', async () => {
  const boxes = [
    { south: -2.6, west: 140.7, north: -2.5838, east: 140.7162, id: 'a' },
    { south: -2.6, west: 140.72, north: -2.5838, east: 140.7362, id: 'b' },
  ];
  const fetchImpl = fakeApi();
  const result = await collectCellsByProbe({
    key: 'k',
    boxes,
    budget: 1,
    fetchImpl,
  });
  assert.equal(result.requests, 1);
  assert.equal(result.stopped, 'budget');
  assert.equal(result.pending, 1);
});

test('a second run resumes instead of paying for finished boxes', async () => {
  const boxes = [
    { south: -2.6, west: 140.7, north: -2.5838, east: 140.7162, id: 'a' },
    { south: -2.6, west: 140.72, north: -2.5838, east: 140.7362, id: 'b' },
  ];
  const state = { boxes: {}, requests: 0, cells: 0 };
  const first = fakeApi();
  await collectCellsByProbe({ key: 'k', boxes, fetchImpl: first, state });
  assert.equal(first.calls.length, 2);

  const second = fakeApi();
  const resumed = await collectCellsByProbe({
    key: 'k',
    boxes,
    fetchImpl: second,
    state,
  });
  assert.equal(second.calls.length, 0, 'nothing is re-fetched');
  assert.equal(resumed.requests, 0);
});

test('a rejected key stops the probe after one credit', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ error: 'API Key not known: ', code: 2 }),
    };
  };
  const boxes = probeBoxes(
    { id: 'x', lat: -4.1, lon: 138.95 },
    { radiusKm: 3, boxKm: 1.8 },
  );
  const result = await collectCellsByProbe({ key: 'bad', boxes, fetchImpl });
  assert.equal(result.stopped, 'invalid_key');
  assert.equal(calls, 1, '16 boxes are not attempted with a bad key');
});

test('the download page is scraped for the country link, token included', async () => {
  const html = `
    <a href="https://opencellid.org/ocid/downloads?token=abc&amp;type=full&amp;file=cell_towers.csv.gz">all</a>
    <a href="https://opencellid.org/ocid/downloads?token=abc&amp;type=mcc&amp;file=510.csv.gz">510</a>`;
  const fetchImpl = async (url, options) => {
    assert.match(url, /downloads\.php$/);
    assert.equal(options.method, 'POST');
    assert.match(options.body, /token=abc/);
    return { ok: true, status: 200, text: async () => html };
  };
  const resolved = await resolveDownloadUrl({
    token: 'abc',
    mcc: 510,
    fetchImpl,
  });
  assert.equal(resolved.ok, true);
  assert.match(resolved.url, /type=mcc&file=510\.csv\.gz$/);
  assert.match(resolved.url, /token=abc/);
});

test('a missing country file is reported, not guessed', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      '<a href="/ocid/downloads?type=mcc&file=999.csv.gz">999</a>',
  });
  const resolved = await resolveDownloadUrl({
    token: 'abc',
    mcc: 510,
    fetchImpl,
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.error, 'country_export_missing');
});

test('a gzipped export is read as text, and a plain one too', () => {
  const text = 'LTE,510,10,1,2,0,140.7,-2.6,1000,5,1,0,0,0\n';
  assert.equal(readExportText(gzipSync(Buffer.from(text))), text);
  assert.equal(readExportText(Buffer.from(text)), text);
});

test('the export is filtered to Papua and clustered into sites', () => {
  const text = [
    'LTE,510,10,10062,1,0,140.7175,-2.5337,1000,40,1,0,0,0',
    'LTE,510,10,10062,2,0,140.7176,-2.5338,1000,30,1,0,0,0',
    'GSM,510,10,10062,3,0,140.7174,-2.5336,35000,12,1,0,0,0',
    'LTE,510,10,41004,9,0,106.8322,-6.1869,7988,50,1,0,0,0',
    '',
  ].join('\n');
  const { rows, sites } = sitesFromExport(text, {
    bbox: PAPUA_BBOX,
    mergeM: 120,
  });
  assert.equal(rows, 3, 'Jakarta is outside the box');
  assert.equal(sites.length, 1, 'three cells on one mast');
  assert.equal(sites[0].cells.length, 3);
  assert.equal(sites[0].source, 'opencellid');
});

test('a cell that appears twice is stored once', () => {
  const cells = [
    cell(-4.1, 138.95, 1),
    cell(-4.1, 138.95, 1),
    cell(-4.2, 138.95, 2),
  ];
  assert.equal(dedupeCells(cells).length, 2);
});

test('four cells on two masts become two sites', () => {
  const cells = [
    cell(-4.1, 138.95, 1),
    cell(-4.1001, 138.9501, 2),
    cell(-4.2, 138.96, 3),
    cell(-4.2001, 138.9601, 4),
  ];
  const sites = cellsToSites(cells, { mergeM: 120 });
  assert.equal(sites.length, 2);
  assert.equal(
    sites.reduce((sum, site) => sum + site.cells.length, 0),
    4,
  );
  for (const site of sites) {
    assert.ok(site.id);
    assert.equal(site.source, 'opencellid');
    assert.ok(site.rangeKm > 0);
  }
});

test('a partial refresh merges at the cell level, not the site level', () => {
  // The same mast seen by two sources: the export knows cells 11 and 12, the
  // API knows 13. Site-level merging would keep two towers here.
  const existing = [
    {
      id: 'old-a',
      mcc: 510,
      mnc: 10,
      lat: -4.1,
      lon: 138.95,
      tech: '4G',
      rangeKm: 5,
      samples: 20,
      cells: [
        { lac: 1, cellId: 11 },
        { lac: 1, cellId: 12 },
      ],
    },
    {
      id: 'osm-mast',
      lat: -4.2,
      lon: 138.96,
      tech: '3G',
      rangeKm: 10,
      cells: [],
    },
  ];
  const incoming = [cell(-4.10005, 138.95005, 13)];
  const merged = rebuildSites(existing, incoming, { mergeM: 120 });
  assert.equal(merged.length, 2, 'one tower plus the cell-less mast');
  const tower = merged.find((site) => site.id !== 'osm-mast');
  assert.equal(tower.cells.length, 3, 'every cell of the mast is kept');
  assert.ok(
    merged.some((site) => site.id === 'osm-mast'),
    'a site with no cells survives',
  );
});

test('a site is named after the town it serves and its operator', () => {
  // Sentani, just outside Jayapura — the nearest capital in the seed.
  const label = siteLabel({
    mcc: 510,
    mnc: 10,
    lat: -2.5658,
    lon: 140.5212,
    tech: '4G',
  });
  assert.equal(label, 'Sentani · Telkomsel 4G');
  // Far from any known town: coordinates are the honest label.
  const remote = siteLabel({
    mcc: 510,
    mnc: 30,
    lat: -6.9,
    lon: 133.2,
    tech: '2G',
  });
  assert.match(remote, /^-6\.900, 133\.200 · XL Axiata 2G$/);
});

test('only imported sites are renamed; a seed or OSM site keeps its name', () => {
  const sites = [
    {
      id: 'a',
      name: '4G 510-10 · 26 sampel',
      source: 'opencellid',
      mcc: 510,
      mnc: 10,
      lat: -2.5658,
      lon: 140.5212,
      tech: '4G',
    },
    {
      id: 'b',
      name: 'Mast A',
      source: 'openstreetmap',
      lat: -4.1,
      lon: 138.95,
    },
  ];
  const named = nameSites(sites);
  assert.equal(named[0].name, 'Sentani · Telkomsel 4G');
  assert.equal(named[1].name, 'Mast A');
});

test('without a token the probe refuses instead of inventing a registry', async () => {
  const result = await collectCellsByProbe({
    key: '',
    boxes: [],
    fetchImpl: fakeApi(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'key_required');
  assert.deepEqual(result.cells, []);
});

test('the default probe covers a town core in 25 API-sized boxes', () => {
  const boxes = probeBoxes({ id: 'wamena', lat: -4.1, lon: 138.95 });
  assert.equal(boxes.length, 25, 'ceil(8 / 1.8)² = 5 × 5, an 8 km square');
  for (const box of boxes) assert.ok(boxFits(box));
});

test('an exhausted daily quota stops the probe instead of grinding', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    text: async () =>
      JSON.stringify({
        error: 'Daily limit exceeded for your API key',
        code: 7,
      }),
  });
  const boxes = probeBoxes({ id: 'x', lat: -4.1, lon: 138.95 });
  const result = await collectCellsByProbe({ key: 'k', boxes, fetchImpl });
  assert.equal(result.stopped, 'quota_exceeded');
});

test('a malformed box stops the run: the grid is wrong, not the area', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({
        error: 'BBOX too big - Limit to 4,000,000 sq.mts.',
        code: 3,
      }),
  });
  const boxes = probeBoxes({ id: 'x', lat: -4.1, lon: 138.95 });
  const result = await collectCellsByProbe({ key: 'k', boxes, fetchImpl });
  assert.equal(result.stopped, 'input_rejected');
});

test('a state file from another grid scheme is ignored', () => {
  const file = path.join(os.tmpdir(), `gev-bts-state-${process.pid}.json`);
  writeFileSync(
    file,
    JSON.stringify({ version: 1, boxes: { a: { done: true } }, requests: 9 }),
  );
  const state = loadState(file);
  assert.deepEqual(state.boxes, {}, 'stale marks are dropped');
  assert.equal(state.requests, 0);
  saveState(file, { ...state, boxes: { b: { done: true } }, requests: 3 });
  const again = loadState(file);
  assert.equal(
    again.version,
    undefined,
    'version is written, not read back as state',
  );
  assert.ok(again.boxes.b.done);
});

test('a box id is the ground it covers, not the town that asked for it', () => {
  const fromTown = probeBoxes({ id: 'wamena', lat: -4.1, lon: 138.95 });
  const fromCustom = probeBoxes({ id: 'custom', lat: -4.1, lon: 138.95 });
  assert.deepEqual(
    fromTown.map((box) => box.id),
    fromCustom.map((box) => box.id),
    'the same square has one id however it was reached',
  );
  assert.ok(
    fromTown.every((box) => !box.id.includes(':')),
    'no centre prefix in the id',
  );
});

test('a legacy state key is normalised to its coordinates', () => {
  assert.equal(normalizeBoxKey('custom:-2.5903,140.6615'), '-2.5903,140.6615');
  assert.equal(
    normalizeBoxKey('bts-510-10-1-2:-2.5903,140.6615'),
    '-2.5903,140.6615',
  );
  assert.equal(normalizeBoxKey('-2.5903,140.6615'), '-2.5903,140.6615');
});

test('legacy marks survive re-keying, so paid ground is not billed twice', () => {
  const boxes = normalizeBoxes({
    'bts-510-10-1-2:-2.5903,140.6615': { done: true, cells: 4 },
    'custom:-2.5903,140.6615': { done: false },
    'custom:-2.5741,140.6615': { done: true, cells: 3 },
  });
  assert.deepEqual(Object.keys(boxes).sort(), [
    '-2.5741,140.6615',
    '-2.5903,140.6615',
  ]);
  assert.equal(boxes['-2.5903,140.6615'].done, true, 'the done mark wins');
  assert.equal(boxes['-2.5903,140.6615'].cells, 4);
});

test('a missing or broken box map normalises to an empty object', () => {
  assert.deepEqual(normalizeBoxes(null), {});
  assert.deepEqual(normalizeBoxes('nope'), {});
});

test('credits accumulate across runs instead of resetting to the last sweep', async () => {
  const box = {
    south: -2.6,
    west: 140.7,
    north: -2.5838,
    east: 140.7162,
    id: '-2.6,140.7',
  };
  const state = { boxes: {}, requests: 425, cells: 0 };
  const first = await collectCellsByProbe({
    key: 'k',
    boxes: [box],
    state,
    fetchImpl: fakeApi(),
  });
  assert.equal(first.requests, 1);
  assert.equal(state.requests, 426, 'the earlier 425 is not thrown away');

  const next = {
    south: -2.6,
    west: 140.72,
    north: -2.5838,
    east: 140.7362,
    id: '-2.6,140.72',
  };
  const second = await collectCellsByProbe({
    key: 'k',
    boxes: [next],
    state,
    fetchImpl: fakeApi(),
  });
  assert.equal(second.requests, 1);
  assert.equal(state.requests, 427, 'a second run adds to the total');
});
