import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTargetProfile,
  clampRadiusKm,
  handleTarget,
  haversineKm,
  parseCoordinate,
  parseOverpassElements,
} from './target.js';
import { clearSearchCache, parseSearxngResults, searchWeb } from './search.js';

const NOW = Date.parse('2026-10-22T09:00:00Z');

const NOMINATIM = [
  {
    display_name: 'Madrid, Community of Madrid, Spain',
    lat: '40.41678',
    lon: '-3.70351',
  },
];

const RSS = [
  '<rss><channel>',
  '<item><title>Madrid council approves a new plan</title>',
  '<link>https://example.org/madrid-1</link>',
  '<pubDate>Thu, 22 Oct 2026 01:00:00 GMT</pubDate>',
  '<source>Example</source></item>',
  '<item><title>Madrid housing market slows</title>',
  '<link>https://example.org/madrid-2</link>',
  '<pubDate>Wed, 21 Oct 2026 01:00:00 GMT</pubDate>',
  '<source>Example</source></item>',
  '</channel></rss>',
].join('');

const OVERPASS = {
  elements: [
    {
      type: 'node',
      id: 1,
      lat: 40.41678,
      lon: -3.70351,
      tags: { name: 'Puerta del Sol', amenity: 'cafe' },
    },
    {
      type: 'way',
      id: 2,
      center: { lat: 40.42, lon: -3.7 },
      tags: { name: 'Casa de Campo', amenity: 'park' },
    },
    {
      type: 'node',
      id: 3,
      lat: 40.5,
      lon: -3.70351,
      tags: { name: 'Instituto Goya', amenity: 'school' },
    },
    {
      type: 'node',
      id: 4,
      lat: 40.9,
      lon: -3.70351,
      tags: { name: 'Far Field School', amenity: 'school' },
    },
    {
      type: 'node',
      id: 5,
      lat: 40.41,
      lon: -3.70351,
      tags: { building: 'yes' },
    },
    {
      type: 'node',
      id: 6,
      lat: 40.42,
      lon: -3.70351,
      tags: { name: 'Untagged Name' },
    },
  ],
};

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
  };
}

/** An offline network: every source answers from a fixture. */
function fakeNetwork({ searxng = 'down', overpass = 'up' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, method: init.method || 'GET' });
    if (href.includes('nominatim')) return jsonResponse(NOMINATIM);
    if (href.includes('news.google.com')) return textResponse(RSS);
    if (href.includes('127.0.0.1:8080')) {
      if (searxng === 'down') throw new Error('connect ECONNREFUSED');
      if (searxng === 'answer') {
        return jsonResponse({
          results: [
            {
              url: 'https://example.org/searx',
              title: 'Madrid',
              content: 'a snippet',
              engine: 'duckduckgo',
              publishedDate: '2026-10-21T10:00:00Z',
            },
          ],
        });
      }
      return jsonResponse({}, 502);
    }
    if (href.includes('overpass')) {
      if (overpass === 'down') throw new Error('overpass is unreachable');
      if (overpass === 'error')
        return jsonResponse({ remark: 'runtime error' });
      return jsonResponse(OVERPASS);
    }
    throw new Error(`unexpected request: ${href}`);
  };
  return { fetchImpl, calls };
}

function responseRecorder() {
  const sent = [];
  return {
    sent,
    res: {
      set statusCode(value) {
        this.code = value;
      },
      get statusCode() {
        return this.code;
      },
      setHeader() {},
      end(body) {
        sent.push({ code: this.code, body: JSON.parse(body) });
      },
    },
  };
}

test.beforeEach(() => {
  clearSearchCache();
});

test('an empty target is refused with a clear reason', async () => {
  await assert.rejects(
    () => buildTargetProfile('   '),
    (error) => {
      assert.equal(error.code, 'target_required');
      assert.match(error.message, /target name is required/);
      return true;
    },
  );
});

test('the radius stays inside the range the panel offers', () => {
  assert.equal(clampRadiusKm(undefined), 25);
  assert.equal(clampRadiusKm('40'), 40);
  assert.equal(clampRadiusKm('900'), 100);
  assert.equal(clampRadiusKm('-5'), 25);
});

test('a coordinate pair is read as a position, not as a name', () => {
  assert.deepEqual(parseCoordinate('-3.7, 140.5'), { lat: -3.7, lon: 140.5 });
  assert.deepEqual(parseCoordinate('-3.7;140.5'), { lat: -3.7, lon: 140.5 });
  assert.equal(parseCoordinate('Merauke'), null);
  assert.equal(parseCoordinate('200, 300'), null);
  assert.equal(parseCoordinate(''), null);
});

test('a coordinate target skips the geocoder and keeps the point', async () => {
  const { fetchImpl, calls } = fakeNetwork();
  const profile = await buildTargetProfile('-3.7, 140.5', { fetchImpl });
  assert.equal(profile.position.status, 'ok');
  assert.equal(profile.position.lat, -3.7);
  assert.equal(profile.position.lon, 140.5);
  assert.equal(profile.position.source, 'coordinate');
  assert.equal(
    calls.some((call) => call.href.includes('nominatim')),
    false,
    'a point is already a position',
  );
});

test('a region hint disambiguates the name it is sent with', async () => {
  const { fetchImpl, calls } = fakeNetwork();
  await buildTargetProfile('Merauke', { fetchImpl, hint: 'Papua, Indonesia' });
  const geocode = calls.find((call) => call.href.includes('nominatim'));
  assert.ok(geocode, 'the geocoder was asked');
  assert.match(geocode.href, /Merauke/);
  assert.match(geocode.href, /Papua/);
});

/**
 * Run a body with an Overpass instance configured.
 *
 * The console asks no public instance by default, so a test that wants the
 * nearby block answered has to name one. The fake network answers any URL
 * that mentions Overpass.
 *
 * @param {() => Promise<unknown>} body
 * @returns {Promise<unknown>}
 */
function withOverpass(body) {
  const before = process.env.GEV_OVERPASS_URL;
  process.env.GEV_OVERPASS_URL = 'https://overpass.test/api/interpreter';
  return Promise.resolve()
    .then(body)
    .finally(() => {
      if (before === undefined) delete process.env.GEV_OVERPASS_URL;
      else process.env.GEV_OVERPASS_URL = before;
    });
}

test('the profile fills every block when every source answers', async () => {
  const { fetchImpl } = fakeNetwork();
  const profile = await withOverpass(() =>
    buildTargetProfile('Madrid', {
      fetchImpl,
      now: () => NOW,
    }),
  );

  assert.equal(profile.target, 'Madrid');
  assert.equal(profile.generatedAt, NOW);
  assert.equal(profile.position.status, 'ok');
  assert.equal(profile.position.lat, 40.41678);
  assert.equal(profile.position.radiusKm, 25);
  assert.ok(profile.position.bbox.north > profile.position.lat);

  assert.equal(profile.involvement.status, 'ok');
  assert.equal(profile.involvement.engine, 'fallback');
  assert.equal(profile.involvement.total, 2);
  assert.deepEqual(profile.involvement.bySource, [
    { source: 'Example', count: 2 },
  ]);
  assert.equal(
    profile.involvement.top[0].title,
    'Madrid council approves a new plan',
  );
  assert.equal(
    profile.involvement.top[0].publishedAt,
    Date.parse('Thu, 22 Oct 2026 01:00:00 GMT'),
  );

  assert.equal(profile.nearby.status, 'ok');
  assert.equal(profile.nearby.total, 4);
  assert.equal(profile.nearby.items.length, 3);
  assert.equal(profile.nearby.items[0].name, 'Puerta del Sol');
  assert.equal(profile.nearby.items[0].distanceKm, 0);
  assert.ok(
    profile.nearby.items[0].distanceKm < profile.nearby.items[1].distanceKm,
  );
  assert.equal(
    profile.nearby.items.some((item) => item.name === 'Far Field School'),
    false,
    'an entity outside the radius is dropped',
  );
  assert.deepEqual(profile.nearby.kinds, [
    { kind: 'amenity', count: 2 },
    { kind: 'school', count: 1 },
  ]);

  assert.deepEqual(
    profile.sources.map((source) => [source.name, source.ok]),
    [
      ['nominatim', true],
      ['search', true],
      ['overpass', true],
    ],
  );
});

test('one failing source leaves the other blocks whole', async () => {
  const { fetchImpl } = fakeNetwork({ overpass: 'down' });
  const profile = await withOverpass(() =>
    buildTargetProfile('Madrid', { fetchImpl }),
  );

  assert.equal(profile.position.status, 'ok');
  assert.equal(profile.involvement.status, 'ok');
  assert.equal(profile.nearby.status, 'unavailable');
  assert.match(profile.nearby.detail, /unreachable/);
  assert.equal(profile.nearby.items.length, 0);
  const overpass = profile.sources.find((source) => source.name === 'overpass');
  assert.equal(overpass.ok, false);
});

test('without a configured instance the nearby block says what is missing', async () => {
  const { fetchImpl } = fakeNetwork();
  const before = process.env.GEV_OVERPASS_URL;
  const beforeUpstreams = process.env.OVERPASS_UPSTREAMS;
  delete process.env.GEV_OVERPASS_URL;
  delete process.env.OVERPASS_UPSTREAMS;
  try {
    const profile = await buildTargetProfile('Madrid', { fetchImpl });
    assert.equal(profile.nearby.status, 'unavailable');
    assert.match(profile.nearby.detail, /OVERPASS_UPSTREAMS/);
    assert.equal(profile.position.status, 'ok');
  } finally {
    if (before !== undefined) process.env.GEV_OVERPASS_URL = before;
    if (beforeUpstreams !== undefined)
      process.env.OVERPASS_UPSTREAMS = beforeUpstreams;
  }
});

test('a geocode failure keeps the trace and reports the position as unavailable', async () => {
  const { fetchImpl } = fakeNetwork();
  const failing = async (url, init) => {
    if (String(url).includes('nominatim')) throw new Error('nominatim refused');
    return fetchImpl(url, init);
  };
  const profile = await buildTargetProfile('Madrid', { fetchImpl: failing });

  assert.equal(profile.position.status, 'unavailable');
  assert.equal(profile.involvement.status, 'ok');
  assert.equal(profile.nearby.status, 'unavailable');
  assert.match(profile.position.detail, /refused/);
});

test('the search seam falls back to the keyless feed when the instance is down', async () => {
  const { fetchImpl, calls } = fakeNetwork();
  const answer = await searchWeb('Madrid', { fetchImpl });

  assert.equal(answer.engine, 'fallback');
  assert.equal(answer.ok, true);
  assert.equal(answer.results.length, 2);
  assert.equal(answer.results[0].title, 'Madrid council approves a new plan');
  assert.equal(answer.results[0].source, 'Example');
  assert.match(answer.note, /unreachable/);
  assert.ok(
    calls.some((call) => call.href.includes('127.0.0.1:8080')),
    'the local instance was asked first',
  );
  assert.ok(
    calls.some((call) => call.href.includes('news.google.com')),
    'the fallback answered',
  );
});

test('the search seam prefers the local instance when it answers', async () => {
  const { fetchImpl } = fakeNetwork({ searxng: 'answer' });
  const answer = await searchWeb('Madrid', { fetchImpl });

  assert.equal(answer.engine, 'searxng');
  assert.equal(answer.results[0].url, 'https://example.org/searx');
  assert.equal(answer.results[0].source, 'duckduckgo');
  assert.equal(
    answer.results[0].publishedAt,
    Date.parse('2026-10-21T10:00:00Z'),
  );
});

test('a SearXNG answer is read field by field', () => {
  const results = parseSearxngResults(
    {
      results: [
        {
          url: 'https://example.org/a',
          title: 'A',
          content: 'a snippet',
          engine: 'bing',
          publishedDate: '2026-10-20T00:00:00Z',
        },
        { title: 'no url' },
      ],
    },
    5,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].snippet, 'a snippet');
  assert.equal(results[0].publishedAt, Date.parse('2026-10-20T00:00:00Z'));
});

test('the distance between two points is the distance on the ground', () => {
  const madrid = { lat: 40.4168, lon: -3.7038 };
  const barcelona = { lat: 41.3874, lon: 2.1686 };
  assert.ok(Math.abs(haversineKm(madrid, barcelona) - 505.1) < 1);
  assert.ok(
    Math.abs(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.195) <
      0.01,
  );
  assert.equal(haversineKm(madrid, madrid), 0);
  assert.ok(Number.isNaN(haversineKm(madrid, { lat: null, lon: 1 })));
});

test('the Overpass answer is read into named entities', () => {
  const entities = parseOverpassElements(OVERPASS);
  assert.equal(entities.length, 4);
  assert.equal(entities[0].name, 'Puerta del Sol');
  assert.equal(entities[0].kind, 'amenity');
  assert.equal(entities[1].kind, 'amenity');
  assert.equal(entities[2].kind, 'school');
  assert.equal(entities[2].lat, 40.5);
  assert.equal(entities[3].name, 'Far Field School');
  assert.equal(entities[3].kind, 'school');
});

test('the handler refuses an empty target and answers a good one', async () => {
  const { fetchImpl } = fakeNetwork();
  const { res, sent } = responseRecorder();

  await handleTarget({ method: 'GET', url: '/?target=' }, res);
  assert.equal(sent.at(-1).code, 400);
  assert.equal(sent.at(-1).body.error, 'target_required');

  await handleTarget(
    { method: 'GET', url: '/?target=Madrid&radiusKm=10' },
    res,
    { fetchImpl },
  );
  assert.equal(sent.at(-1).code, 200);
  assert.equal(sent.at(-1).body.ok, true);
  assert.equal(sent.at(-1).body.position.radiusKm, 10);
  assert.equal(sent.at(-1).body.involvement.status, 'ok');
});

test('the handler serves a repeated request from the cache', async () => {
  const { fetchImpl, calls } = fakeNetwork();
  const { res, sent } = responseRecorder();

  await handleTarget({ method: 'GET', url: '/?target=Madrid' }, res, {
    fetchImpl,
  });
  const afterFirst = calls.length;
  await handleTarget({ method: 'GET', url: '/?target=Madrid' }, res, {
    fetchImpl,
  });

  assert.equal(sent.at(-1).code, 200);
  assert.equal(sent.at(-1).body.cached, true);
  assert.equal(calls.length, afterFirst, 'the sources were not asked again');
});
