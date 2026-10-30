import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dailyChanges,
  decay,
  meanStd,
  pctChange,
  scoreDrivers,
  scoreNews,
  zscoreLast,
} from './drivers.js';
import { parseRss } from './news.js';
import { buildGoldImpact, formatGoldReport } from './gold-impact.js';
import { bboxAround, buildPlaceCard, normalizePlace } from './place-card.js';
import { godseyeProxy } from '../godseye.js';

const NOW = Date.parse('2026-10-22T00:00:00Z');

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

test('meanStd measures the mean and the population deviation', () => {
  const { mean, std, n } = meanStd([1, 2, 3, 4]);
  assert.equal(n, 4);
  assert.equal(mean, 2.5);
  assert.ok(Math.abs(std - Math.sqrt(1.25)) < 1e-9);
});

test('zscoreLast is positive for a rising series and zero for a flat one', () => {
  const rising = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  assert.ok(zscoreLast(rising) > 0.5);
  assert.equal(zscoreLast([5, 5, 5, 5, 5, 5]), 0);
  assert.equal(zscoreLast([1, 2]), 0);
});

test('pctChange and dailyChanges report the move between points', () => {
  assert.equal(pctChange([100, 101]), 1);
  assert.equal(pctChange([100, 99]), -1);
  assert.equal(pctChange([100]), null);
  assert.deepEqual(dailyChanges([100, 110, 121]), [10, 10]);
});

test('decay fades a headline with its age', () => {
  assert.equal(Math.round(decay(0) * 1000) / 1000, 1);
  assert.ok(Math.abs(decay(6 * 3600000) - Math.exp(-1)) < 0.001);
  assert.ok(decay(12 * 3600000) < decay(6 * 3600000));
});

test('parseRss reads title, link, source and time', () => {
  const xml =
    '<rss><channel><item><title>Gold &amp; silver rally</title>' +
    '<link>https://example.org/a</link><pubDate>Thu, 22 Oct 2026 01:00:00 GMT</pubDate>' +
    '<source>Example</source></item></channel></rss>';
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Gold & silver rally');
  assert.equal(items[0].source, 'Example');
  assert.equal(
    items[0].publishedAt,
    Date.parse('Thu, 22 Oct 2026 01:00:00 GMT'),
  );
});

test('scoreNews matches keywords and fades older headlines', () => {
  const driver = {
    id: 'fed_policy',
    label: 'Fed',
    weight: 0.9,
    keywords: ['federal reserve'],
  };
  const fresh = [
    { title: 'Federal Reserve signals rate cut', publishedAt: NOW - 3600000 },
  ];
  const old = [
    {
      title: 'Federal Reserve signals rate cut',
      publishedAt: NOW - 24 * 3600000,
    },
  ];
  const freshScore = scoreNews(driver, fresh, NOW);
  const oldScore = scoreNews(driver, old, NOW);
  assert.ok(freshScore.impact > 0);
  assert.ok(oldScore.impact < freshScore.impact);
  assert.equal(scoreNews(driver, [{ title: 'unrelated headline' }], NOW), null);
});

test('scoreDrivers signs a rising dollar and yield against gold', () => {
  const market = {
    dxy: {
      id: 'dxy',
      symbol: 'DX-Y.NYB',
      label: 'DXY',
      sign: -1,
      price: 104,
      series: [100, 100, 100, 100, 100, 100, 100, 104],
    },
    gold: {
      id: 'gold',
      symbol: 'GC=F',
      label: 'Gold',
      sign: 1,
      price: 120,
      series: [100, 100, 100, 100, 100, 100, 100, 120],
    },
    yields: {
      id: 'yields',
      symbol: '^TNX',
      label: '10Y',
      sign: -1,
      price: 4.2,
      series: [4, 4, 4, 4, 4, 4, 4, 4.2],
    },
  };
  const drivers = scoreDrivers({ market, news: [], now: NOW });
  const byId = Object.fromEntries(drivers.map((driver) => [driver.id, driver]));
  assert.ok(byId.gold_self.impact > 0, 'gold up is positive');
  assert.ok(byId.dxy.impact < 0, 'a rising dollar is negative for gold');
  assert.ok(byId.real_yields.impact < 0, 'a rising yield is negative for gold');
  assert.equal(byId.gold_self.direction, 'up');
});

test('a series-only driver is not moved by headlines', () => {
  const market = {
    gold: {
      id: 'gold',
      symbol: 'GC=F',
      label: 'Gold',
      sign: 1,
      price: 120,
      series: [100, 100, 100, 100, 100, 100, 100, 120],
    },
  };
  const news = [
    { title: 'Gold price today hits a new high', publishedAt: NOW - 3600000 },
  ];
  const withNews = scoreDrivers({ market, news, now: NOW });
  const withoutNews = scoreDrivers({ market, news: [], now: NOW });
  const goldWith = withNews.find((driver) => driver.id === 'gold_self');
  const goldWithout = withoutNews.find((driver) => driver.id === 'gold_self');
  assert.equal(goldWith.impact, goldWithout.impact);
});

test('buildGoldImpact merges market, news and events', async () => {
  const feed = await buildGoldImpact({
    now: NOW,
    market: {
      series: [
        {
          id: 'gold',
          symbol: 'GC=F',
          label: 'Gold',
          sign: 1,
          price: 2400,
          changePct: 0.5,
          series: [2300, 2350, 2400],
        },
        {
          id: 'dxy',
          symbol: 'DX-Y.NYB',
          label: 'DXY',
          sign: -1,
          price: 104,
          changePct: 0.2,
          series: [100, 102, 104],
        },
      ],
      failed: [],
    },
    news: {
      items: [
        {
          title: 'Federal Reserve holds rates',
          source: 'Example',
          publishedAt: NOW - 3600000,
          link: 'https://example.org/x',
        },
      ],
      failed: [],
    },
    osint: {
      items: [
        {
          kind: 'earthquake',
          title: 'Earthquake M5.1',
          place: 'Ocean',
          source: 'USGS',
          ts: NOW,
        },
      ],
      failed: [],
    },
  });
  assert.equal(feed.gold.price, 2400);
  assert.equal(feed.gold.changePct, 0.5);
  assert.ok(feed.drivers.length >= 2);
  assert.ok(feed.drivers.some((driver) => driver.id === 'fed_policy'));
  assert.equal(feed.news.length, 1);
  assert.equal(feed.osint.length, 1);
  assert.ok(['up', 'down', 'flat'].includes(feed.composite.direction));
  assert.equal(feed.composite.note, 'relevance score, not a cause');
  assert.match(formatGoldReport(feed), /GOLD IMPACT/);
});

test('bboxAround shrinks with the radius and holds the point', () => {
  const wide = bboxAround(0, 0, 50);
  const tight = bboxAround(0, 0, 10);
  assert.ok(wide.north - wide.south > tight.north - tight.south);
  assert.ok(wide.east - wide.west > tight.east - tight.west);
  assert.ok(wide.south < 0 && wide.north > 0);
});

test('normalizePlace reads both geocode shapes', () => {
  const google = normalizePlace(
    {
      results: [
        { name: 'Ubud', geometry: { location: { lat: -8.5, lng: 115.25 } } },
      ],
    },
    'app-geocode',
  );
  assert.equal(google.name, 'Ubud');
  assert.equal(google.lat, -8.5);
  const nominatim = normalizePlace(
    [{ display_name: 'Montreal, Quebec', lat: '45.5', lon: '-73.6' }],
    'nominatim',
  );
  assert.equal(nominatim.name, 'Montreal, Quebec');
  assert.equal(nominatim.lon, -73.6);
  assert.equal(normalizePlace(null, 'x'), null);
});

test('buildPlaceCard returns place, photo and render intent', async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes('nominatim')) {
      return jsonResponse([
        { display_name: 'Madrid, Spain', lat: '40.4168', lon: '-3.7035' },
      ]);
    }
    if (href.includes('kartaview')) {
      return jsonResponse({
        result: {
          data: [
            {
              id: '9',
              imageProcUrl: 'https://cdn.kartaview.org/p.jpg',
              imageThUrl: 'https://cdn.kartaview.org/t.jpg',
              dateAdded: '2024-05-05',
              lat: '40.4168',
              lng: '-3.7035',
            },
          ],
        },
      });
    }
    return jsonResponse({}, 404);
  };
  const card = await buildPlaceCard('Madrid', { fetchImpl });
  assert.equal(card.place.name, 'Madrid, Spain');
  assert.equal(card.photo.id, '9');
  assert.equal(card.intent.tool, 'show_in_gods_eye_view');
  assert.match(card.intent.providerSwitches, /kartaview-1/);
});

test('the proxy answers the documented routes and rejects a bad query', async () => {
  const routes = new Map();
  const plugin = godseyeProxy();
  plugin.configureServer({
    middlewares: {
      use: (path, handler) => routes.set(path, handler),
    },
  });
  assert.ok(routes.has('/api/godseye/gold-impact'));
  assert.ok(routes.has('/api/godseye/place-card'));

  const responses = [];
  const res = {
    set statusCode(value) {
      this.code = value;
    },
    get statusCode() {
      return this.code;
    },
    setHeader() {},
    end(body) {
      responses.push({ code: this.code, body });
    },
  };
  await routes.get('/api/godseye/place-card')({ method: 'GET', url: '/' }, res);
  assert.equal(responses.at(-1).code, 400);
  assert.match(responses.at(-1).body, /query_required/);
});
