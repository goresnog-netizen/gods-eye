import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildLiveSnapshot,
  installLocalIntel,
  rewriteHlsPlaylist,
  viewshedCacheKey,
} from './local-intel.js';

// The track store is a real local artifact, so the tests write to a temporary
// file instead of the one the application uses.
process.env.GODSEYE_TARGET_HISTORY = path.join(
  os.tmpdir(),
  `gev-target-history-${process.pid}.json`,
);

// The BTS registry is a data artifact that a sweep can fill at any time. The
// tests below describe the seed, so they point the route at a file that does
// not exist and let it fall back — otherwise the suite would change meaning
// every time someone runs `npm run bts:sweep`.
process.env.GODSEYE_BTS_REGISTRY = path.join(
  os.tmpdir(),
  `gev-bts-absent-${process.pid}.json`,
);

// The audit log writes as a side effect of answering, so it gets its own
// directory instead of the one the application uses.
process.env.GEV_AUDIT_DIR = path.join(os.tmpdir(), `gev-audit-${process.pid}`);
process.env.GEV_AUDIT_SALT = 'test-salt';
// The terrain probe inside /capabilities must not depend on the network or
// on whatever tiles happen to be cached on this machine: an empty DEM dir plus
// the offline switch is a machine with no terrain model.
process.env.GEV_DEM_OFFLINE = '1';
process.env.GEV_DEM_DIR = path.join(
  os.tmpdir(),
  `gev-dem-absent-${process.pid}`,
);
// The imagery route proxies real tiles; seeding the cache keeps it off the
// network while still exercising the route's headers and plumbing.
process.env.GEV_TILE_DIR = path.join(
  os.tmpdir(),
  `gev-tiles-route-${process.pid}`,
);

/**
 * Mount the routes on a fake connect server so a handler can be called
 * directly. The middleware receives a real `req`-shaped object and a recorder
 * that keeps the status, headers and body it produced.
 */
function mount() {
  const routes = new Map();
  installLocalIntel({
    middlewares: {
      use(path, handler) {
        routes.set(path, handler);
      },
    },
  });
  return routes;
}

function recorder() {
  const sent = { headers: {}, body: '' };
  return {
    sent,
    res: {
      statusCode: 0,
      setHeader(name, value) {
        sent.headers[name.toLowerCase()] = value;
      },
      end(body) {
        sent.body = body;
      },
    },
  };
}

async function call(path, query, method = 'GET') {
  const routes = mount();
  const handler = routes.get(path);
  assert.equal(typeof handler, 'function', `${path} is mounted`);
  const { sent, res } = recorder();
  await handler({ method, url: `${path}${query}` }, res);
  let json = null;
  try {
    json = JSON.parse(sent.body);
  } catch {
    json = null;
  }
  return {
    status: res.statusCode,
    headers: sent.headers,
    body: sent.body,
    json,
  };
}

test('every local route is mounted', () => {
  const routes = mount();
  assert.deepEqual([...routes.keys()].sort(), [
    '/api/godseye/anomaly',
    '/api/godseye/audit',
    '/api/godseye/bts',
    '/api/godseye/capabilities',
    '/api/godseye/cctv',
    '/api/godseye/cctv-stream',
    '/api/godseye/export',
    '/api/godseye/imagery',
    '/api/godseye/intel',
    '/api/godseye/locate',
    '/api/godseye/news',
    '/api/godseye/score',
    '/api/godseye/stream',
    '/api/godseye/verify',
  ]);
});

test('a scan without a point is refused instead of guessed', async () => {
  const result = await call('/api/godseye/cctv', '');
  assert.equal(result.status, 400);
  assert.equal(result.json.error, 'point_required');
});

test('a non-GET request is refused', async () => {
  const result = await call('/api/godseye/cctv', '?catalog=1', 'POST');
  assert.equal(result.status, 405);
  assert.equal(result.json.error, 'method_not_allowed');
});

test('the catalog answers with the local counts', async () => {
  const result = await call('/api/godseye/cctv', '?catalog=1');
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.ok(result.json.counts.total > 0, 'the catalog has cameras');
  assert.equal(result.json.counts.byType.phone, 8, 'phone cameras are counted');
  assert.ok(result.json.cities.includes('Jayapura'));
});

test('a scan inside Tolikara lists cameras ordered by distance', async () => {
  const result = await call(
    '/api/godseye/cctv',
    '?lat=-3.6833&lon=138.4833&radiusKm=200',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.source, 'local-catalog');
  assert.ok(result.json.count > 0, 'cameras are in range');
  for (const camera of result.json.inside) {
    assert.ok(
      Number.isFinite(camera.distance),
      'each camera carries a distance',
    );
    assert.ok(camera.distance <= 200);
  }
});

test('a camera type filter keeps only that type', async () => {
  const result = await call(
    '/api/godseye/cctv',
    '?lat=-6.2&lon=106.8167&radiusKm=500&type=phone',
  );
  assert.equal(result.status, 200);
  for (const camera of result.json.inside) assert.equal(camera.type, 'phone');
});

test('a target name resolves to a position', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=Target%20Papua%201&legalBasis=consent',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.mode, 'target');
  assert.equal(result.json.matchType, 'name');
  assert.ok(Number.isFinite(result.json.target.lat));
  assert.ok(Number.isFinite(result.json.target.lon));
});

test('a phone number resolves to the same catalog target', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=%2B62-812-3456-7890&legalBasis=consent',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.mode, 'target');
  assert.equal(result.json.matchType, 'phone');
  assert.equal(result.json.target.name, 'Target Papua 1');
});

test('a number outside the catalog names its operator and offers network context', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=085212347890&legalBasis=consent',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.mode, 'phone');
  assert.equal(result.json.phone.operator, 'Telkomsel');
  assert.equal(result.json.position, null);
  assert.equal(result.json.network, null, 'no point, no network list yet');
  assert.match(result.json.networkHint, /lat=\.\.\.&lon=\.\.\./);
});

test('a supplied point fills the network with towers of the same operator', async () => {
  const registryFile = path.join(
    os.tmpdir(),
    `gev-bts-network-${process.pid}.json`,
  );
  writeFileSync(
    registryFile,
    JSON.stringify({
      source: 'test-registry',
      synthetic: false,
      sites: [
        {
          id: 't-1',
          name: 'Kota · Telkomsel 4G',
          lat: -2.53,
          lon: 140.71,
          tech: '4G',
          rangeKm: 5,
          mcc: 510,
          mnc: 10,
          cells: [{ lac: 10062, cellId: 106271263 }],
          samples: 26,
        },
        {
          id: 't-2',
          name: 'Kota · Telkomsel 3G',
          lat: -2.6,
          lon: 140.8,
          tech: '3G',
          rangeKm: 10,
          mcc: 510,
          mnc: 10,
          cells: [],
        },
        {
          id: 'x-1',
          name: 'Kota · XL Axiata 4G',
          lat: -2.53,
          lon: 140.72,
          tech: '4G',
          rangeKm: 5,
          mcc: 510,
          mnc: 30,
          cells: [],
        },
      ],
    }),
  );
  const previous = process.env.GODSEYE_BTS_REGISTRY;
  process.env.GODSEYE_BTS_REGISTRY = registryFile;
  try {
    const result = await call(
      '/api/godseye/locate',
      '?q=085212347890&legalBasis=consent&lat=-2.53&lon=140.71',
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.network.basis, 'caller-supplied-point');
    assert.equal(result.json.network.operator, 'Telkomsel');
    assert.equal(result.json.network.towers.length, 2, 'XL tower excluded');
    assert.ok(
      result.json.network.towers.every((t) => t.distanceKm >= 0),
    );
    assert.equal(result.json.network.towers[0].id, 't-1', 'nearest first');
    assert.ok(Number.isFinite(result.json.network.towers[0].bearing));
  } finally {
    process.env.GODSEYE_BTS_REGISTRY = previous;
  }
});

test('an out-of-range context point degrades to metadata instead of a claim', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=085212347890&legalBasis=consent&lat=999&lon=140',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.network, null, 'an invalid point is not a point');
  assert.ok(result.json.networkHint);
});

test('an unknown target is a 404 with the reason', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=nobody-here&legalBasis=consent',
  );
  assert.equal(result.status, 404);
  assert.equal(result.json.error, 'not_found');
  assert.match(result.json.detail, /nobody-here/);
});

test('a region lists the targets inside it', async () => {
  const result = await call('/api/godseye/locate', '?region=papua');
  assert.equal(result.status, 200);
  assert.equal(result.json.mode, 'region');
  assert.equal(result.json.count, 8);
});

test('a cell identifier is answered locally and stays put', async () => {
  const first = await call('/api/godseye/locate', '?q=510-10-12345-67890');
  assert.equal(first.status, 200);
  assert.equal(first.json.mode, 'cell');
  assert.equal(
    first.json.live,
    false,
    'no provider is called without opting in',
  );
  assert.equal(first.json.estimated, true);
  assert.equal(first.json.source, 'local-estimate');
  assert.ok(Number.isFinite(first.json.position.lat));
  assert.ok(Number.isFinite(first.json.position.lon));

  const second = await call('/api/godseye/locate', '?q=510-10-12345-67890');
  assert.deepEqual(
    second.json.position,
    first.json.position,
    'the same cell id always resolves to the same point',
  );
});

test('one carrier is not pinned to a single city', async () => {
  // Telkomsel serves every province; the LAC decides which region a cell of
  // that carrier lands in, so the same carrier must not always be Jayapura.
  const regions = new Set();
  for (const lac of [0, 1, 2, 3, 4, 5]) {
    const found = await call('/api/godseye/locate', `?q=510-10-${lac}-777`);
    assert.equal(found.status, 200);
    assert.ok(found.json.estimateRegion, 'the region is reported');
    assert.equal(found.json.accuracyM, 20000, 'a 16 km spread is a 20 km fix');
    regions.add(found.json.estimateRegion);
  }
  assert.ok(regions.size >= 4, `regions seen: ${[...regions].join(', ')}`);
});

test('a handle resolves to the same target as its phone', async () => {
  const byHandle = await call(
    '/api/godseye/locate',
    '?q=%40tolikara.desk&legalBasis=consent',
  );
  assert.equal(byHandle.status, 200);
  assert.equal(byHandle.json.mode, 'target');
  assert.equal(byHandle.json.matchType, 'username');
  assert.equal(byHandle.json.target.name, 'Target Papua 7');
  assert.equal(byHandle.json.target.username, '@tolikara.desk');

  const withoutAt = await call(
    '/api/godseye/locate',
    '?q=tolikara.desk&legalBasis=consent',
  );
  assert.equal(withoutAt.json.target.id, byHandle.json.target.id);

  const byPhone = await call(
    '/api/godseye/locate',
    '?q=%2B62-818-7890-1234&legalBasis=consent',
  );
  assert.equal(byPhone.json.target.id, byHandle.json.target.id);
});

test('the news tab answers from the local artifact', async () => {
  const papua = await call('/api/godseye/news', '?region=papua&limit=5');
  assert.equal(papua.status, 200);
  assert.equal(papua.json.region, 'papua');
  assert.ok(papua.json.total > 0);
  assert.ok(papua.json.items.length <= 5);
  for (const item of papua.json.items) {
    assert.ok(item.title);
    assert.match(String(item.query).toLowerCase(), /papua/);
  }

  const all = await call('/api/godseye/news', '?region=indonesia&limit=5');
  assert.equal(all.status, 200);
  assert.ok(
    all.json.total >= papua.json.total,
    'Indonesia holds every headline, Papua a subset',
  );
});

test('the news tab lists the world topics without touching the network', async () => {
  const topics = await call('/api/godseye/news', '?topics=1');
  assert.equal(topics.status, 200);
  assert.equal(topics.json.ok, true);
  assert.equal(topics.json.live, true);
  const ids = topics.json.topics.map((topic) => topic.id);
  for (const expected of ['west-papua', 'knpb', 'ulmwp', 'free-papua']) {
    assert.ok(ids.includes(expected), `topic ${expected} is advertised`);
  }
  for (const topic of topics.json.topics) {
    assert.ok(topic.label);
    assert.ok(topic.query);
  }
});

test('a live world query with an unknown topic is refused', async () => {
  const result = await call('/api/godseye/news', '?live=1&topic=does-not-exist');
  assert.equal(result.status, 400);
  assert.equal(result.json.error, 'unknown_topic');
});

test('a second cell for the same carrier extends one track', async () => {
  const first = await call('/api/godseye/locate', '?q=510-99-12345-100');
  assert.equal(first.status, 200);
  assert.equal(first.json.track.track, 'cell:510-99');
  assert.equal(first.json.track.points, 1);
  assert.equal(first.json.track.distanceKm, 0, 'one fix is no distance');

  const second = await call('/api/godseye/locate', '?q=510-99-12345-900');
  assert.equal(second.json.track.points, 2);
  assert.ok(
    second.json.track.distanceKm > 0,
    'a different cell lands somewhere else',
  );
  assert.ok(Number.isFinite(second.json.track.bearing));
  assert.equal(typeof second.json.track.hasAnomaly, 'boolean');
  assert.ok(Array.isArray(second.json.track.anomalies));
});

test('the track can be read back without adding a fix', async () => {
  const before = await call('/api/godseye/locate', '?q=510-99-12345-900');
  const read = await call('/api/godseye/anomaly', '?track=cell:510-99');
  assert.equal(read.status, 200);
  assert.equal(
    read.json.points,
    before.json.track.points,
    'reading adds nothing',
  );
  assert.equal(read.json.track, 'cell:510-99');
});

test('the tracks that exist can be listed', async () => {
  const listed = await call('/api/godseye/anomaly', '?list=1');
  assert.equal(listed.status, 200);
  const tracks = listed.json.tracks.map((entry) => entry.track);
  assert.ok(tracks.includes('cell:510-99'));
  for (const entry of listed.json.tracks) assert.ok(entry.points > 0);
});

test('a track with a real interval reports a real speed', async () => {
  // Written straight to the store: the route stamps Date.now(), so a synthetic
  // two-minute gap is the only way to exercise the speed arithmetic.
  const started = Date.now() - 120_000;
  writeFileSync(
    process.env.GODSEYE_TARGET_HISTORY,
    JSON.stringify({
      'cell:510-30': [
        { lat: -4.5461, lon: 136.8876, timestamp: started },
        { lat: -4.6361, lon: 136.8876, timestamp: started + 120_000 },
      ],
    }),
  );
  const read = await call('/api/godseye/anomaly', '?track=cell:510-30');
  assert.equal(read.status, 200);
  assert.equal(read.json.points, 2);
  assert.equal(read.json.speedReliable, true);
  assert.ok(
    read.json.distanceKm > 9 && read.json.distanceKm < 12,
    'about 10 km',
  );
  assert.ok(read.json.avgSpeedKmh > 0, 'a two-minute gap has a speed');
  assert.equal(read.json.intervalSec, 120);
});

test('the BTS registry reports what it holds and that it is a seed', async () => {
  const result = await call('/api/godseye/bts', '?catalog=1');
  assert.equal(result.status, 200);
  assert.ok(result.json.sites >= 30);
  assert.equal(
    result.json.synthetic,
    true,
    'the seed is never passed off as real',
  );
  assert.ok(result.json.byTech['4G'] > 0);
  assert.ok(result.json.byTech['2G'] > 0);
});

test('a point answers how near the closest site is', async () => {
  // Wamena town centre: the site of that name is at the same coordinate.
  const result = await call('/api/godseye/bts', '?lat=-4.1&lon=138.95');
  assert.equal(result.status, 200);
  assert.equal(result.json.nearest.name, 'Wamena Kota');
  assert.ok(result.json.nearest.distanceKm < 1);
  assert.ok(result.json.nearest.coveragePct <= 100);
  assert.equal(result.json.inCoverage, true);
  assert.equal(result.json.class, 'near');
});

test('a point far from every site says so', async () => {
  const result = await call('/api/godseye/bts', '?lat=-6.9&lon=133.2');
  assert.equal(result.status, 200);
  assert.ok(result.json.nearest.distanceKm > 100);
  assert.equal(result.json.inCoverage, false);
  assert.equal(result.json.class, 'far');
});

test('a cell the registry cannot place is reported as unknown', async () => {
  const result = await call('/api/godseye/bts', '?cells=510-11-12345-67890');
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.matched, []);
  assert.equal(result.json.position.ok, false);
  assert.match(result.json.hint, /import a registry/);
});

test('a located target carries its nearest site', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=%40wamena.watch&legalBasis=consent',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.bts.name, 'Wamena Kota');
  assert.ok(result.json.bts.distanceKm < 1);
  assert.equal(result.json.bts.synthetic, true);
});

test('the BTS route refuses a request with no point and no cells', async () => {
  const result = await call('/api/godseye/bts', '');
  assert.equal(result.status, 400);
  assert.equal(result.json.error, 'point_required');
});

test('an imported registry replaces the seed and is not marked synthetic', async () => {
  const file = path.join(os.tmpdir(), `gev-bts-registry-${process.pid}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      source: 'opencellid:test',
      sites: [
        {
          id: 'bts-test-1',
          name: 'Imported tower',
          lat: -4.1,
          lon: 138.95,
          tech: '4G',
          rangeKm: 5,
          cells: [{ lac: 1, cellId: 2 }],
          source: 'opencellid',
        },
      ],
    }),
  );
  const previous = process.env.GODSEYE_BTS_REGISTRY;
  process.env.GODSEYE_BTS_REGISTRY = file;
  try {
    const catalog = await call('/api/godseye/bts', '?catalog=1');
    assert.equal(catalog.json.sites, 1);
    assert.equal(catalog.json.source, 'opencellid:test');
    assert.equal(catalog.json.synthetic, false);

    // The imported cell is now placeable, which the seed never was.
    const placed = await call('/api/godseye/bts', '?cells=510-10-1-2');
    assert.equal(placed.json.matched.length, 1);
    assert.equal(placed.json.matched[0].site.id, 'bts-test-1');
    assert.equal(
      placed.json.position.ok,
      false,
      'one site is still not a position',
    );
  } finally {
    if (previous === undefined) delete process.env.GODSEYE_BTS_REGISTRY;
    else process.env.GODSEYE_BTS_REGISTRY = previous;
  }
});

test('an unknown track is a 404, a missing one a 400', async () => {
  const missing = await call('/api/godseye/anomaly', '?track=cell:000-00');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, 'track_not_found');

  const unnamed = await call('/api/godseye/anomaly', '');
  assert.equal(unnamed.status, 400);
  assert.equal(unnamed.json.error, 'track_required');
});

test('an unknown score profile is refused with the known ones', async () => {
  const result = await call('/api/godseye/score', '?profile=nonsense');
  assert.equal(result.status, 400);
  assert.equal(result.json.error, 'unknown_profile');
  assert.ok(result.json.profiles.includes('default'));
});

test('the score weights the four lanes and reports severity', async () => {
  const result = await call(
    '/api/godseye/score',
    '?profile=security&news=0.8&osint=0.6&vision=0.4&market=0.2',
  );
  assert.equal(result.status, 200);
  assert.ok(result.json.composite > 0 && result.json.composite <= 1);
  assert.equal(result.json.profile, 'security');
  assert.ok(
    ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(result.json.severity),
  );
});

test('the dashboard score reads the local artifact', async () => {
  const result = await call('/api/godseye/score', '?source=dashboard');
  assert.equal(result.status, 200);
  assert.equal(result.json.basis, 'dashboard-indonesia.json');
  assert.ok(result.json.composite >= 0);
});

test('the GeoJSON export is a FeatureCollection', async () => {
  const result = await call('/api/godseye/export', '?format=geojson');
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /geo\+json/);
  assert.match(result.headers['content-disposition'], /attachment/);
  assert.equal(result.json.type, 'FeatureCollection');
  assert.ok(result.json.features.length > 0);
  for (const feature of result.json.features) {
    assert.equal(feature.type, 'Feature');
    assert.ok(Array.isArray(feature.geometry.coordinates));
  }
});

test('the KML export is a Document', async () => {
  const result = await call('/api/godseye/export', '?format=kml&scope=cctv');
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /kml/);
  assert.match(result.body, /<Document>/);
  assert.match(result.body, /<\/kml>/);
});

test('the CSV export starts with the requested columns', async () => {
  const result = await call('/api/godseye/export', '?format=csv&scope=vision');
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /text\/csv/);
  const [header, ...rows] = result.body.split('\n');
  assert.equal(header, 'id,name,kind,lat,lon,city,type,provider');
  assert.ok(rows.length > 0, 'vision areas are exported');
});

test('an unknown export format is refused with the known ones', async () => {
  const result = await call('/api/godseye/export', '?format=shapefile');
  assert.equal(result.status, 400);
  assert.equal(result.json.error, 'unknown_format');
  assert.deepEqual(result.json.formats, ['geojson', 'kml', 'csv']);
});

test('the summary reports what is available locally', async () => {
  const result = await call('/api/godseye/intel', '');
  assert.equal(result.status, 200);
  assert.equal(result.json.source, 'local-only');
  assert.ok(result.json.cctv.total > 0);
  assert.ok(result.json.targets > 0);
  assert.ok(result.json.visionAreas > 0);
});

test('the live snapshot is small, current and local', async () => {
  const snapshot = await buildLiveSnapshot();
  assert.equal(snapshot.source, 'local-only');
  assert.match(snapshot.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(snapshot.cctv > 0);
  assert.ok(snapshot.papuaCameras > 0);
  assert.ok(snapshot.targets > 0);
  assert.ok(snapshot.visionAreas > 0);
  // The feed carries counts, not records: a badge does not need the catalog.
  assert.equal(snapshot.cameras, undefined);
  assert.ok(Object.keys(snapshot).length < 12);
});

/** A registry file the route can read, cleaned up by the caller. */
function writeRegistry(payload) {
  const file = path.join(
    os.tmpdir(),
    `gev-bts-${process.pid}-${Math.random().toString(16).slice(2)}.json`,
  );
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

async function withRegistry(payload, run) {
  const file = writeRegistry(payload);
  const previous = process.env.GODSEYE_BTS_REGISTRY;
  process.env.GODSEYE_BTS_REGISTRY = file;
  try {
    return await run(file);
  } finally {
    if (previous === undefined) delete process.env.GODSEYE_BTS_REGISTRY;
    else process.env.GODSEYE_BTS_REGISTRY = previous;
  }
}

test('a cell the registry knows is placed at the tower, not estimated', async () => {
  // The whole point of importing a registry: the answer stops being a guess.
  await withRegistry(
    {
      source: 'opencellid:test',
      sites: [
        {
          id: 'bts-wmn-1',
          name: 'Wamena Kota',
          lat: -4.1,
          lon: 138.95,
          tech: '4G',
          rangeKm: 5,
          cells: [{ lac: 4242, cellId: 777 }],
        },
      ],
    },
    async () => {
      const result = await call('/api/godseye/locate', '?q=510-10-4242-777');
      assert.equal(result.status, 200);
      assert.equal(result.json.source, 'bts-registry');
      assert.equal(result.json.positionBasis, 'known-tower');
      assert.equal(result.json.estimated, false);
      assert.deepEqual(result.json.position, { lat: -4.1, lon: 138.95 });
      assert.equal(
        result.json.accuracyM,
        5000,
        'the tower range bounds the handset',
      );
      assert.equal(result.json.site.id, 'bts-wmn-1');
      assert.equal(result.json.province.id, 'papua-pegunungan');
      assert.equal(result.json.registry.synthetic, false);
    },
  );
});

test('a cell no registry knows still answers, and says it is an estimate', async () => {
  // LAC 7 lands in Wamena's region for Telkomsel, so the estimate is inside
  // Papua and the province can be named.
  const result = await call('/api/godseye/locate', '?q=510-10-7-555');
  assert.equal(result.status, 200);
  assert.equal(result.json.source, 'local-estimate');
  assert.equal(result.json.positionBasis, 'carrier-region-estimate');
  assert.equal(result.json.estimated, true);
  assert.ok(result.json.province, 'an estimate is still placed in a province');
});

test('coverage is reported per province, not as one island figure', async () => {
  const result = await call('/api/godseye/bts', '?coverage=1');
  assert.equal(result.status, 200);
  assert.equal(result.json.provinces.length, 6);
  assert.ok(result.json.totals.sites > 0);
  for (const row of result.json.provinces) {
    assert.ok(row.name, 'every province is named');
    assert.ok(row.samplePoints > 0, 'every province is sampled');
    assert.equal(typeof row.coveredPct, 'number');
    assert.equal(row.basis, 'province-bbox-raster');
  }
  const withSites = result.json.provinces.filter((row) => row.sites > 0);
  assert.ok(withSites.length >= 5, 'the seed covers most of the island');
});

test('one province can be asked about on its own', async () => {
  const result = await call(
    '/api/godseye/bts',
    '?coverage=1&province=papua-pegunungan',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.provinces.length, 1);
  assert.equal(result.json.provinces[0].id, 'papua-pegunungan');
  assert.equal(result.json.province, 'papua-pegunungan');
});

test('the sites of one province can be listed without a point', async () => {
  const result = await call('/api/godseye/bts', '?province=papua-selatan');
  assert.equal(result.status, 200);
  assert.equal(result.json.province.id, 'papua-selatan');
  assert.ok(result.json.items.length > 0, 'the south has sites in the seed');
  for (const site of result.json.items) {
    assert.ok(Number.isFinite(site.lat) && Number.isFinite(site.lon));
  }
});

test('the catalog counts sites per province and keeps its attribution', async () => {
  const result = await call('/api/godseye/bts', '?catalog=1');
  assert.equal(result.status, 200);
  assert.ok(Object.keys(result.json.byProvince).length >= 5);
  assert.equal(
    result.json.byProvince['outside-papua'],
    undefined,
    'the seed is all Papua',
  );
  assert.equal(
    result.json.generatedAt,
    null,
    'the seed has no generation date',
  );
});

test('a located point reports the province it sits in', async () => {
  const result = await call('/api/godseye/bts', '?lat=-8.4932&lon=140.4018');
  assert.equal(result.status, 200);
  assert.equal(result.json.province, 'Papua Selatan');
});

test('the BTS layer exports like every other layer', async () => {
  const result = await call('/api/godseye/export', '?format=geojson&scope=bts');
  assert.equal(result.status, 200);
  assert.equal(result.json.type, 'FeatureCollection');
  const points = result.json.features.filter(
    (feature) => feature.properties.__type === 'point',
  );
  assert.ok(points.length > 0);
  for (const feature of points) {
    assert.equal(feature.properties.kind, 'bts');
    assert.ok(Number.isFinite(feature.geometry.coordinates[0]));
  }
});

test('the summary counts the registry alongside the other local layers', async () => {
  const result = await call('/api/godseye/intel', '');
  assert.equal(result.status, 200);
  assert.ok(result.json.bts.sites > 0);
  assert.equal(result.json.bts.source, 'local-seed');
  assert.equal(result.json.bts.synthetic, true);
  assert.ok(Object.keys(result.json.bts.byProvince).length >= 5);
});

test('the capability table says what is measured and what is only a sample', async () => {
  const result = await call('/api/godseye/capabilities', '');
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  const ids = result.json.rows.map((row) => row.id);
  for (const id of [
    'bts-registry',
    'cell-locate',
    'phone-locate',
    'cctv',
    'ais',
  ]) {
    assert.ok(ids.includes(id), `${id} is listed`);
  }
  // Terrain is unreachable in the test environment, so the rows say so
  // instead of claiming a model that cannot run here.
  const terrain = result.json.rows.find((row) => row.id === 'terrain');
  assert.equal(terrain.status, 'estimate');
  const viewshedRow = result.json.rows.find((row) => row.id === 'viewshed');
  assert.equal(viewshedRow.status, 'estimate');
  const phone = result.json.rows.find((row) => row.id === 'phone-locate');
  assert.equal(phone.status, 'catalog', 'a number is not a position');
  assert.match(phone.needs, /cell id/);
  assert.match(result.json.disclaimer, /catalog/i);
  // The seed registry is what the route sees in the test environment.
  const bts = result.json.rows.find((row) => row.id === 'bts-registry');
  assert.equal(bts.status, 'catalog');
});

test('a phone number resolves to a sample entry and says so', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=%2B62-812-3456-7890&legalBasis=consent',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.mode, 'target');
  assert.equal(result.json.matchType, 'phone');
  assert.equal(result.json.source, 'local-catalog');
  assert.equal(result.json.synthetic, true);
  assert.equal(result.json.capability, 'catalog-sample');
  assert.match(result.json.notice, /cannot be geolocated/);
  // The cameras are the real catalogue around that point, not a fabricated one
  // sitting exactly on the target.
  assert.ok(result.json.cctv.count >= 0);
  for (const camera of result.json.cctv.cameras) {
    assert.ok(
      Number.isFinite(camera.distance),
      'a nearby camera carries its distance',
    );
  }
});

test('a person-directed query without a legal basis is refused, not answered', async () => {
  const refused = await call('/api/godseye/locate', '?q=Target%20Papua%201');
  assert.equal(refused.status, 428);
  assert.equal(refused.json.error, 'legal_basis_required');
  assert.ok(refused.json.accepted.includes('consent'));
  assert.equal(refused.json.target, undefined, 'nothing was resolved');
});

test('an invented legal basis is refused with the accepted ones', async () => {
  const refused = await call(
    '/api/godseye/locate',
    '?q=Target%20Papua%201&legalBasis=because',
  );
  assert.equal(refused.status, 428);
  assert.equal(refused.json.error, 'legal_basis_unknown');
  assert.match(refused.json.detail, /because/);
});

test('a cell id is technical, so it answers without a basis', async () => {
  const result = await call('/api/godseye/locate', '?q=510-10-12345-999');
  assert.equal(result.status, 200);
  assert.equal(result.json.mode, 'cell');
  assert.ok(result.json.audit.seq > 0, 'it is still recorded');
});

test('every answer carries the audit entry that recorded it', async () => {
  const result = await call(
    '/api/godseye/locate',
    '?q=Target%20Papua%202&legalBasis=public-task',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.legalBasis, 'public-task');
  assert.match(result.json.audit.hash, /^[0-9a-f]{64}$/);

  const log = await call('/api/godseye/audit', '?limit=5');
  assert.equal(log.status, 200);
  assert.ok(log.json.count > 0);
  assert.match(log.json.entries[0].queryHash, /^q_/);
  assert.equal(
    JSON.stringify(log.json.entries).includes('Target Papua 2'),
    false,
    'the log holds a hash, not the text',
  );

  const verified = await call('/api/godseye/audit', '?verify=1');
  assert.equal(verified.status, 200);
  assert.equal(verified.json.ok, true);
});

test('an export carries the credit inside the file and in the headers', async () => {
  const geojson = await call(
    '/api/godseye/export',
    '?format=geojson&scope=bts',
  );
  assert.equal(geojson.status, 200);
  assert.match(geojson.headers['x-attribution'], /OpenCelliD/);
  assert.match(geojson.headers['x-license'], /CC BY-SA 4\.0/);
  assert.ok(
    geojson.json.metadata.attribution.some((line) => /OpenCelliD/.test(line)),
    'the credit is in the body, where it cannot be stripped',
  );

  const csv = await call('/api/godseye/export', '?format=csv&scope=bts');
  assert.match(csv.body, /# attribution: .*OpenCelliD/);
  const [header] = csv.body.split('\n');
  assert.equal(
    header,
    'id,name,kind,lat,lon,city,type,provider',
    'the header stays first',
  );

  const kml = await call('/api/godseye/export', '?format=kml&scope=bts');
  assert.match(kml.body, /<description>.*OpenCelliD/);
});

test('a viewshed is computed for a named site', async () => {
  const result = await call('/api/godseye/bts', '?viewshed=1&site=bts-wmn-01');
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  // With no DEM the model still answers, over flat ground: the honest
  // fallback is the planning cap, not a refusal.
  assert.equal(result.json.site.lat, -4.1);
  assert.ok(result.json.stats.maxKm > 0);
  assert.ok(Array.isArray(result.json.polygon));
  assert.equal(result.json.polygon[0].length, 2, 'lon, lat pairs');
});

test('an ad-hoc viewshed works from a coordinate', async () => {
  const result = await call(
    '/api/godseye/bts',
    '?viewshed=1&lat=-2.58&lon=140.72&tech=4G&heightM=30',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.site.groundM, 0, 'flat earth without a DEM');
  assert.ok(result.json.stats.meanKm > 0);
});

test('a viewshed with no site and no point is a 400', async () => {
  const result = await call('/api/godseye/bts', '?viewshed=1');
  assert.equal(result.status, 400);
  assert.equal(result.json.error, 'site_required');
});

test('the imagery route returns the real tile with its credit', async () => {
  const { fetchImageryTile, tileIndex } =
    await import('../../services/place-card-local/imagery.mjs');
  // A 1x1 PNG is enough: the route forwards the bytes it is given.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  mkdirSync(
    path.join(
      process.env.GEV_TILE_DIR,
      '15',
      String(tileIndex(-2.5337, 140.7175, 15).x),
    ),
    { recursive: true },
  );
  writeFileSync(
    path.join(
      process.env.GEV_TILE_DIR,
      '15',
      String(tileIndex(-2.5337, 140.7175, 15).x),
      `${tileIndex(-2.5337, 140.7175, 15).y}.jpg`,
    ),
    png,
  );

  const result = await call(
    '/api/godseye/imagery',
    '?lat=-2.5337&lon=140.7175&zoom=15',
  );
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /image\/jpeg/);
  assert.match(result.headers['x-attribution'], /Esri/);
  assert.match(result.headers['x-imagery-source'], /esri-world-imagery/);
  assert.equal(result.body.length, png.length, 'the bytes are the tile');
});

test('the imagery route describes a tile without sending it', async () => {
  const result = await call(
    '/api/godseye/imagery',
    '?lat=-2.5337&lon=140.7175&zoom=15&meta=1',
  );
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.ok(result.json.groundM > 0, 'the ground each pixel covers is stated');
  assert.match(result.json.credit.text, /Copernicus/);
});

test('the imagery route without a point is a 400', async () => {
  const result = await call('/api/godseye/imagery', '');
  assert.equal(result.status, 400);
  assert.equal(result.json.error, 'point_required');
});

test('the verify route cross-checks the height and lists its sources', async () => {
  const result = await call('/api/godseye/verify', '?lat=-2.5337&lon=140.7175');
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  // Two DEMs answer over the network here; the verdict is whatever they say,
  // but the shape has to hold either way.
  assert.ok(
    ['agree', 'rough', 'disagree', 'one-source-only'].includes(
      result.json.height.verdict,
    ),
    `verdict is known: ${result.json.height.verdict}`,
  );
  assert.ok(result.json.height.detail.length > 10, 'the verdict is explained');
  const ids = result.json.sources.map((source) => source.id);
  assert.ok(ids.includes('esri-world-imagery'));
  assert.ok(ids.includes('open-meteo-elevation'));
});

test('the capability table now lists the free sources it leans on', async () => {
  const result = await call('/api/godseye/capabilities', '');
  assert.equal(result.json.freeSources.total > 0, true);
  assert.ok(
    result.json.freeSources.keyless >= 5,
    'Esri, Open-Meteo x2, RainViewer, Wikimedia',
  );
  assert.ok(
    result.json.freeSources.needsKey.includes('unwired-labs'),
    'the missing keys are named',
  );
});

test('the catalog can hand the registry itself to the globe layer', async () => {
  const result = await call('/api/godseye/bts', '?catalog=1&sites=1');
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.json.sites), 'the sites are the payload');
  assert.equal(
    result.json.sites.length,
    42,
    'the seed registry in the test environment',
  );
  const site = result.json.sites[0];
  assert.ok(
    Number.isFinite(site.lat) && Number.isFinite(site.lon),
    'a site carries its position',
  );
  assert.ok(Array.isArray(site.cells), 'and the cells it serves');
  // The summary the panel reads stays available on the same route.
  const counts = await call('/api/godseye/bts', '?catalog=1');
  assert.equal(counts.json.sites, 42);
  assert.equal(
    counts.json.sites.length,
    undefined,
    'counts are numbers, not a list',
  );
});

test('two ad-hoc coordinates never share a cached viewshed', () => {
  const mountain = { id: 'adhoc', lat: -4.0975, lon: 138.9517 };
  const coast = { id: 'adhoc', lat: -2.5337, lon: 140.7181 };
  assert.notEqual(
    viewshedCacheKey(mountain, '4G'),
    viewshedCacheKey(coast, '4G'),
    'the same id for two places must not collapse to one key',
  );
  assert.equal(
    viewshedCacheKey(mountain, '4G', { clutterModel: 'landcover' }),
    viewshedCacheKey({ ...mountain }, '4G', { clutterModel: 'landcover' }),
    'the same site and model still hits the cache',
  );
  assert.notEqual(
    viewshedCacheKey(mountain, '4G'),
    viewshedCacheKey(mountain, '4G', { tiltDeg: 6 }),
  );
});

test('rewriteHlsPlaylist re-targets every URI line through the proxy', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=981944,RESOLUTION=640x360',
    'video1_stream.m3u8',
    '#EXTINF:4.0,',
    'seg001.mp4',
    '',
  ].join('\n');
  const out = rewriteHlsPlaylist(
    playlist,
    'https://atcs.banjarmasinkota.go.id/stream/cam/index.m3u8',
  );
  const lines = out.split('\n');
  assert.equal(lines[0], '#EXTM3U', 'tags are untouched');
  assert.match(lines[2], /^\/api\/godseye\/cctv-stream\?url=/);
  assert.match(
    decodeURIComponent(lines[2]),
    /video1_stream\.m3u8$/,
    'relative URI resolved against the playlist base',
  );
  assert.match(
    decodeURIComponent(lines[4]),
    /seg001\.mp4$/,
    'segment URI resolves against the same base',
  );
});
