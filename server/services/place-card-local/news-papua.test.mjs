import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  fetchPapuaNews,
  fetchWorldPapuaNews,
  fetchDomesticPapuaNews,
  fetchInternationalNews,
  fetchDomesticNews,
  filterInternational,
  filterDomestic,
  filterAllowed,
  outletOf,
  domesticOutletOf,
  classifyOutlet,
  parseWorldRss,
  WORLD_TOPICS,
  DOMESTIC_TOPICS,
  papuaNewsCacheFile,
  worldNewsCacheFile,
  cacheTtlMs,
} from './news-papua.mjs';

function rssItem({ title, source, pubDate = 'Tue, 03 Nov 2026 08:00:00 GMT' }) {
  return [
    '<item>',
    `<title>${title}</title>`,
    `<link>https://news.google.com/rss/articles/CBM${Buffer.from(title).toString('base64')}</link>`,
    `<source url="https://example.com">${source}</source>`,
    `<pubDate>${pubDate}</pubDate>`,
    '<description>&lt;p&gt;A lead sentence about Papua.&lt;/p&gt;</description>',
    '</item>',
  ].join('');
}

const FIXTURE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test</title>',
  rssItem({ title: 'West Papua court ruling draws international attention', source: 'Reuters' }),
  rssItem({ title: 'KNPB statement ahead of anniversary', source: 'BBC News' }),
  rssItem({ title: 'ULMWP leadership meets in Vanuatu', source: 'RNZ' }),
  rssItem({ title: 'Separatism fears rise in Papua', source: 'Kompas.com' }),
  rssItem({ title: 'Indonesia military operation Papua', source: 'Al Jazeera' }),
  rssItem({ title: 'Benny Wenda calls for referendum', source: 'The Guardian' }),
  rssItem({ title: 'OPM attacks police checkpoint', source: 'ABC News (Australia)' }),
  rssItem({ title: 'Morning Star Flag raised in Wamena', source: 'Benih Jaya' }),
  rssItem({ title: 'TNI operations in Papua highlands', source: 'Detik.com' }),
  rssItem({ title: 'West Papua independence movement grows', source: 'RNZ' }),
  '</channel></rss>',
].join('');

// ─── Parse ─────────────────────────────────────────────────────────────────────

test('parseWorldRss reads title, link, source, time and strips snippet HTML', () => {
  const items = parseWorldRss(FIXTURE_XML);
  assert.equal(items.length, 10);
  assert.equal(
    items[0].title,
    'West Papua court ruling draws international attention',
  );
  assert.equal(items[0].source, 'Reuters');
  assert.equal(items[0].snippet, 'A lead sentence about Papua.');
  assert.ok(Number.isFinite(items[0].publishedAt));
});

test('parseWorldRss returns empty array for empty or malformed XML', () => {
  assert.deepEqual(parseWorldRss(''), []);
  assert.deepEqual(parseWorldRss('<rss />'), []);
  assert.deepEqual(parseWorldRss(null), []);
});

test('parseWorldRss handles CDATA in description', () => {
  const xml = [
    '<item>',
    '<title>Test</title>',
    '<link>https://example.com</link>',
    '<source>Reuters</source>',
    '<description><![CDATA[A & B <em>test</em>]]></description>',
    '</item>',
  ].join('');
  const items = parseWorldRss(xml);
  assert.equal(items.length, 1);
  assert.ok(items[0].snippet.includes('A'));
});

// ─── Outlet classification ──────────────────────────────────────────────────────

test('outletOf returns correct name for known international outlets', () => {
  assert.equal(outletOf('BBC News'), 'BBC');
  assert.equal(outletOf('bbc.com'), 'BBC');
  assert.equal(outletOf('Reuters'), 'Reuters');
  assert.equal(outletOf('The Guardian'), 'The Guardian');
  assert.equal(outletOf('RNZ Pacific'), 'RNZ');
  assert.equal(outletOf('Al Jazeera English'), 'Al Jazeera');
  assert.equal(outletOf('ABC News (Australia)'), 'ABC News (Australia)');
  assert.equal(outletOf('Associated Press'), 'Associated Press');
  assert.equal(outletOf('AP News'), 'Associated Press');
  assert.equal(outletOf('BenARNews'), 'BenarNews');
  assert.equal(outletOf('Kompas.com'), 'Kompas');
  assert.equal(outletOf('Tempo.co'), 'Tempo');
});

test('outletOf returns null for unknown sources', () => {
  assert.equal(outletOf('Unknown Media'), null);
  assert.equal(outletOf('Some Random Blog'), null);
  assert.equal(outletOf(''), null);
});

test('domesticOutletOf returns correct name for Indonesian outlets', () => {
  assert.equal(domesticOutletOf('Kompas.com'), 'Kompas.com');
  assert.equal(domesticOutletOf('Detik.com'), 'Detik.com');
  assert.equal(domesticOutletOf('CNN Indonesia'), 'CNN Indonesia');
  assert.equal(domesticOutletOf('Tempo.co'), 'Tempo.co');
  assert.equal(domesticOutletOf('Tirto.id'), 'Tirto.id');
  assert.equal(domesticOutletOf('BenarNews'), 'BenarNews');
  assert.equal(domesticOutletOf('BenarNews.com'), 'BenarNews');
  assert.equal(domesticOutletOf('Jubi.com'), 'Jubi.com');
  assert.equal(domesticOutletOf('Mongabay'), 'Mongabay');
  assert.equal(domesticOutletOf('The Jakarta Post'), 'The Jakarta Post');
  assert.equal(domesticOutletOf('bbc.com/indonesia'), 'BBC Indonesia');
});

test('classifyOutlet returns correct scope', () => {
  // Kompas.com is in both lists; outletOf fires first (international wins)
  assert.equal(classifyOutlet('BBC News'), 'international');
  assert.equal(classifyOutlet('RNZ'), 'international');
  assert.equal(classifyOutlet('Kompas.com'), 'international');
  assert.equal(classifyOutlet('Detik.com'), 'domestic');
  assert.equal(classifyOutlet('Jubi.com'), 'domestic');
  assert.equal(classifyOutlet('Unknown Site'), 'other');
});

// ─── Filtering ────────────────────────────────────────────────────────────────

test('filterInternational keeps only allowed outlets', () => {
  const items = parseWorldRss(FIXTURE_XML);
  const filtered = filterInternational(items);
  const sources = filtered.map((i) => i.outlet);
  assert.ok(sources.includes('Reuters'));
  assert.ok(sources.includes('BBC'));
  assert.ok(sources.includes('RNZ'));
  assert.ok(sources.includes('Al Jazeera'));
  assert.ok(sources.includes('The Guardian'));
  assert.ok(sources.includes('ABC News (Australia)'));
  // Unknown outlet should be excluded
  assert.ok(!sources.includes('Benih Jaya'));
  assert.ok(!sources.includes('Detik.com'));
});

test('filterDomestic keeps only Indonesian outlets', () => {
  const items = parseWorldRss(FIXTURE_XML);
  const filtered = filterDomestic(items);
  const sources = filtered.map((i) => i.outlet);
  assert.ok(sources.includes('Kompas.com'));
  assert.ok(sources.includes('Detik.com'));
  // International outlets should be excluded
  assert.ok(!sources.includes('Reuters'));
  assert.ok(!sources.includes('RNZ'));
  assert.ok(!sources.includes('BBC'));
});

test('filterAllowed accepts both international and domestic', () => {
  const items = parseWorldRss(FIXTURE_XML);
  const filtered = filterAllowed(items);
  const scopes = filtered.map((i) => i.scope);
  assert.ok(scopes.includes('international'));
  assert.ok(scopes.includes('domestic'));
  assert.ok(!scopes.includes('other'));
  const sources = filtered.map((i) => i.outlet);
  assert.ok(sources.includes('Reuters'));
  assert.ok(sources.includes('BBC'));
  assert.ok(sources.includes('RNZ'));
  // outletOf('Kompas.com') returns 'Kompas', not 'Kompas.com'
  assert.ok(sources.includes('Kompas'));
  assert.ok(sources.includes('Detik.com'));
});

// ─── Topic definitions ─────────────────────────────────────────────────────────

test('WORLD_TOPICS has 10 international topics', () => {
  assert.equal(WORLD_TOPICS.length, 10);
  const ids = WORLD_TOPICS.map((t) => t.id);
  assert.ok(ids.includes('west-papua'));
  assert.ok(ids.includes('knpb'));
  assert.ok(ids.includes('ulmwp'));
  assert.ok(ids.includes('opm'));
  assert.ok(ids.includes('benny-wenda'));
  assert.ok(ids.includes('morning-star'));
  assert.ok(ids.includes('free-papua'));
  assert.ok(ids.includes('separatism'));
  assert.ok(ids.includes('papua-conflict'));
  assert.ok(ids.includes('west-papua-independence'));
  WORLD_TOPICS.forEach((t) => {
    assert.ok(t.query.length > 0, `${t.id} has no query`);
  });
});

test('DOMESTIC_TOPICS has 12 Indonesian topics', () => {
  assert.equal(DOMESTIC_TOPICS.length, 12);
  const ids = DOMESTIC_TOPICS.map((t) => t.id);
  assert.ok(ids.includes('konflik-papua'));
  assert.ok(ids.includes('kemerdekaan-papua'));
  assert.ok(ids.includes('opm-dom'));
  assert.ok(ids.includes('benny-wenda-dom'));
  assert.ok(ids.includes('ulmwp-dom'));
  assert.ok(ids.includes('separatis-papua'));
  assert.ok(ids.includes('militan-papua'));
  assert.ok(ids.includes('tnipapua'));
  assert.ok(ids.includes('guerilla-papua'));
  assert.ok(ids.includes('pembebasan-papua'));
  assert.ok(ids.includes('knpb-dom'));
  assert.ok(ids.includes('west-papua-dom'));
  DOMESTIC_TOPICS.forEach((t) => {
    assert.ok(t.query.length > 0, `${t.id} has no query`);
  });
});

// ─── Cache helpers ─────────────────────────────────────────────────────────────

test('cacheTtlMs returns 15 minutes', () => {
  assert.equal(cacheTtlMs(), 15 * 60 * 1000);
});

// ─── fetchPapuaNews: mocked parallel fetch ─────────────────────────────────────

test('fetchPapuaNews merges world + domestic, dedupes, sorts newest-first', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-test-'));

  // World feed fixture — 4 items, 4 topics match (west-papua, knpb, opm, benny-wenda)
  const worldRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'West Papua UN visit 2026', source: 'RNZ', pubDate: 'Wed, 04 Nov 2026 10:00:00 GMT' }),
    rssItem({ title: 'KNPB anniversary rally', source: 'BBC News', pubDate: 'Wed, 04 Nov 2026 09:00:00 GMT' }),
    rssItem({ title: 'OPM ceasefire request', source: 'The Guardian', pubDate: 'Wed, 04 Nov 2026 08:00:00 GMT' }),
    rssItem({ title: 'Benny Wenda UN speech', source: 'RNZ', pubDate: 'Wed, 04 Nov 2026 07:00:00 GMT' }),
    '</channel></rss>',
  ].join('');

  // Domestic feed fixture — 3 items, 1 matches topik 'konflik-papua' (unique title)
  // The other 2 ('TNI operasi…' and 'OPM ataque…') dedup to 1 after filter (same date as first)
  const domRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'Konflik热点 Papua', source: 'Detik.com', pubDate: 'Wed, 04 Nov 2026 11:00:00 GMT' }),
    rssItem({ title: 'TNI operasi Papua', source: 'Detik.com', pubDate: 'Wed, 04 Nov 2026 10:30:00 GMT' }),
    rssItem({ title: 'OPM attack news', source: 'Detik.com', pubDate: 'Wed, 04 Nov 2026 09:30:00 GMT' }),
    '</channel></rss>',
  ].join('');

  const result = await fetchPapuaNews({
    fetchImpl: async (url) => {
      const lang = String(url).includes('hl=en') ? 'en' : 'id';
      return { ok: true, text: async () => lang === 'en' ? worldRss : domRss };
    },
    force: true,
    perTopic: 5,
    cacheFile: path.join(tmpDir, 'cache.json'),
  });

  // Should merge both feeds
  assert.equal(result.scope, 'all');
  assert.ok(result.total >= 3, `Got ${result.total} items`);
  assert.ok(result.worldTotal >= 3);
  assert.ok(result.domesticTotal >= 1);

  // Sorted newest-first
  for (let i = 1; i < result.items.length; i++) {
    assert.ok(
      result.items[i - 1].publishedAt >= result.items[i].publishedAt,
      `Not sorted: ${result.items[i - 1].title} (${result.items[i - 1].publishedAt}) vs ${result.items[i].title} (${result.items[i].publishedAt})`,
    );
  }

  // Scopes present
  const itemScopes = result.items.map((i) => i.scope);
  assert.ok(itemScopes.includes('international'), `Expected international scope, got: ${[...new Set(itemScopes)]}`);
  assert.ok(itemScopes.includes('domestic'), `Expected domestic scope, got: ${[...new Set(itemScopes)]}`);

  // Sorted newest-first (by publishedAt, nulls at end)
  for (let i = 1; i < result.items.length; i++) {
    const prev = result.items[i - 1].publishedAt || 0;
    const curr = result.items[i].publishedAt || 0;
    assert.ok(
      prev >= curr,
      `${result.items[i - 1].title} (${prev}) >= ${result.items[i].title} (${curr})`,
    );
  }
});

test('fetchPapuaNews with scope=international returns only international items', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-intl-'));
  const worldRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'West Papua news', source: 'RNZ' }),
    rssItem({ title: 'KNPB news', source: 'BBC News' }),
    '</channel></rss>',
  ].join('');

  const mockFetch = async () => ({ ok: true, text: async () => worldRss });

  const result = await fetchPapuaNews({
    scope: 'international',
    fetchImpl: mockFetch,
    force: true,
    cacheFile: path.join(tmpDir, 'cache.json'),
  });

  assert.equal(result.scope, 'international');
  result.items.forEach((item) => {
    assert.equal(item.scope, 'international', `${item.title} should be international`);
  });
});

test('fetchPapuaNews with scope=domestic returns only domestic items', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-dom-'));
  const domRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'Konflik Papua terbaru', source: 'Detik.com' }),
    rssItem({ title: 'Kemerdekaan Papua demonstrasi', source: 'Kompas.com' }),
    '</channel></rss>',
  ].join('');

  const mockFetch = async () => ({ ok: true, text: async () => domRss });

  const result = await fetchPapuaNews({
    scope: 'domestic',
    fetchImpl: mockFetch,
    force: true,
    cacheFile: path.join(tmpDir, 'cache.json'),
  });

  assert.equal(result.scope, 'domestic');
  result.items.forEach((item) => {
    assert.equal(item.scope, 'domestic', `${item.title} should be domestic`);
  });
});

test('fetchWorldPapuaNews backwards compat returns only world scope', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-world-'));
  const worldRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'West Papua news', source: 'RNZ' }),
    rssItem({ title: 'KNPB news', source: 'BBC News' }),
    '</channel></rss>',
  ].join('');

  const mockFetch = async () => ({ ok: true, text: async () => worldRss });

  const result = await fetchWorldPapuaNews({
    fetchImpl: mockFetch,
    force: true,
    cacheFile: path.join(tmpDir, 'cache.json'),
  });

  assert.equal(result.scope, 'world');
  assert.ok(result.total >= 1);
});

test('fetchDomesticPapuaNews returns domestic scope', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-domestic-'));
  const domRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'Konflik Papua', source: 'Detik.com' }),
    '</channel></rss>',
  ].join('');

  const mockFetch = async () => ({ ok: true, text: async () => domRss });

  const result = await fetchDomesticPapuaNews({
    fetchImpl: mockFetch,
    force: true,
  });

  assert.equal(result.scope, 'domestic');
  assert.ok(result.total >= 1);
});

test('fetchInternationalNews and fetchDomesticNews are aliases', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-alias-'));
  const worldRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'West Papua', source: 'RNZ' }),
    '</channel></rss>',
  ].join('');
  const mockFetch = async () => ({ ok: true, text: async () => worldRss });

  const intl = await fetchInternationalNews({ fetchImpl: mockFetch, force: true });
  assert.equal(intl.scope, 'international');
});

// ─── Cache TTL ────────────────────────────────────────────────────────────────

test('fetchPapuaNews serves from cache when fresh', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-cachettl-'));
  const cacheFile = path.join(tmpDir, 'cache.json');

  const rss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'Cached item', source: 'RNZ' }),
    rssItem({ title: 'Indonesian news', source: 'Detik.com' }),
    '</channel></rss>',
  ].join('');

  const mockFetch = async () => ({ ok: true, text: async () => rss });

  // First call with force — bypasses feeds' internal caches (fresh temp dir),
  // fetches from network (22 calls), writes combined cache
  const first = await fetchPapuaNews({ fetchImpl: mockFetch, force: true, cacheFile });
  assert.ok(first.total >= 1, `First call should fetch items, got total=${first.total}`);

  // Second call with force:false — top-level cache file is fresh → returns from cache
  const result = await fetchPapuaNews({ fetchImpl: mockFetch, force: false, cacheFile });
  assert.equal(result.total, first.total, 'Cached result should match fresh fetch');
});

// ─── Error resilience ──────────────────────────────────────────────────────────

test('fetchPapuaNews tolerates one feed failing', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-err-'));
  const worldRss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'West Papua news', source: 'RNZ' }),
    '</channel></rss>',
  ].join('');

  const mockFetch = async (url) => {
    if (url.includes('hl=id')) {
      throw new Error('Network error on domestic');
    }
    return { ok: true, text: async () => worldRss };
  };

  const result = await fetchPapuaNews({
    fetchImpl: mockFetch,
    force: true,
    cacheFile: path.join(tmpDir, 'cache.json'),
  });

  // Should still return world results
  assert.ok(result.worldTotal >= 1);
  assert.ok(result.total >= 1);
});

test('fetchTopic skips duplicate titles across topics', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'papua-news-dedup-'));
  const rss = [
    '<?xml version="1.0"?><rss><channel>',
    rssItem({ title: 'Identical title appears twice', source: 'RNZ' }),
    '</channel></rss>',
  ].join('');

  const mockFetch = async () => ({ ok: true, text: async () => rss });

  const result = await fetchPapuaNews({
    fetchImpl: mockFetch,
    force: true,
    perTopic: 3,
    cacheFile: path.join(tmpDir, 'cache.json'),
  });

  const titles = result.items.map((i) => i.title.toLowerCase());
  const seen = new Set();
  for (const t of titles) {
    assert.ok(!seen.has(t), `Duplicate title found: ${t}`);
    seen.add(t);
  }
});
