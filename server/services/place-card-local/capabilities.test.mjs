import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCapabilities } from './capabilities.mjs';

const FACTS = {
  bts: {
    sites: 1901,
    cells: 4415,
    source: 'opencellid:api-probe',
    synthetic: false,
  },
  cctv: {
    total: 51,
    papua: 26,
    byType: { fixed: 40, phone: 8, 'ip-camera': 3 },
  },
  targets: { count: 12 },
  news: { total: 127, papua: 84 },
  vision: { areas: 10 },
  env: { visionModel: 'qwen2.5vl:3b', opencellid: true },
};

test('every capability states its status, its source and what it would need', () => {
  const table = buildCapabilities(FACTS);
  assert.ok(table.rows.length >= 12);
  for (const row of table.rows) {
    assert.ok(row.id && row.name, 'a row needs an id and a name');
    assert.ok(
      ['real', 'estimate', 'catalog', 'artifact', 'blocked'].includes(
        row.status,
      ),
      `${row.id} has a known status (${row.status})`,
    );
    assert.ok(row.detail, `${row.id} says something concrete`);
  }
});

test('the summary counts what the table holds', () => {
  const table = buildCapabilities(FACTS);
  const counted = table.rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  for (const [status, count] of Object.entries(counted)) {
    assert.equal(table.summary[status], count, `${status} is counted`);
  }
});

test('a real registry makes BTS and cell lookup real', () => {
  const table = buildCapabilities(FACTS);
  const bts = table.rows.find((row) => row.id === 'bts-registry');
  const locate = table.rows.find((row) => row.id === 'cell-locate');
  assert.equal(bts.status, 'real');
  assert.equal(bts.needs, null);
  assert.equal(locate.status, 'real');
  assert.match(bts.detail, /1901 sites · 4415 cells/);
  assert.match(bts.license, /CC BY-SA 4\.0/);
});

test('a seed registry is called a catalogue, not data', () => {
  const table = buildCapabilities({
    ...FACTS,
    bts: { sites: 42, cells: 0, source: 'local-seed', synthetic: true },
  });
  const bts = table.rows.find((row) => row.id === 'bts-registry');
  const locate = table.rows.find((row) => row.id === 'cell-locate');
  assert.equal(bts.status, 'catalog');
  assert.match(bts.needs, /bts:sweep/);
  assert.equal(locate.status, 'estimate', 'no cell ids means a regional guess');
  assert.match(locate.accuracy, /20 km/);
});

test('a phone number is a catalogue entry, never a position', () => {
  const table = buildCapabilities(FACTS);
  const phone = table.rows.find((row) => row.id === 'phone-locate');
  assert.equal(phone.status, 'catalog');
  assert.match(phone.needs, /cell id/);
  assert.match(phone.accuracy, /sample data/);
  assert.match(table.disclaimer, /phone number cannot be geolocated/i);
});

test('a missing feed is blocked with the key it needs', () => {
  const table = buildCapabilities(FACTS);
  const ais = table.rows.find((row) => row.id === 'ais');
  const firms = table.rows.find((row) => row.id === 'firms');
  assert.equal(ais.status, 'blocked');
  assert.equal(ais.needs, 'AISSTREAM_API_KEY');
  assert.equal(firms.needs, 'FIRMS_MAP_KEY');
});

test('no news artifact is blocked, an artifact is reported', () => {
  const without = buildCapabilities({ ...FACTS, news: null });
  assert.equal(without.rows.find((row) => row.id === 'news').status, 'blocked');
  const withNews = buildCapabilities(FACTS);
  assert.equal(
    withNews.rows.find((row) => row.id === 'news').status,
    'artifact',
  );
  assert.match(
    withNews.rows.find((row) => row.id === 'news').detail,
    /127 items, 84 Papua/,
  );
});

test('terrain rows follow whether the DEM can answer', () => {
  const on = buildCapabilities({ terrain: { known: true } });
  const off = buildCapabilities({ terrain: { known: false } });
  const rowOn = on.rows.find((row) => row.id === 'terrain');
  const rowOff = off.rows.find((row) => row.id === 'terrain');
  assert.equal(rowOn.status, 'real');
  assert.match(rowOn.detail, /Terrarium/);
  assert.equal(rowOff.status, 'estimate');
  assert.match(rowOff.needs, /elevation-tiles-prod/);
  // The viewshed inherits the same switch: no DEM, no propagation.
  assert.equal(on.rows.find((row) => row.id === 'viewshed').status, 'real');
  assert.equal(
    off.rows.find((row) => row.id === 'viewshed').status,
    'estimate',
  );
});

test('the trilateration row promises an ellipse, not just a point', () => {
  const table = buildCapabilities({});
  const row = table.rows.find((entry) => entry.id === 'trilateration');
  assert.match(row.detail, /confidence ellipse/);
  assert.match(row.accuracy, /ellipse/);
});
