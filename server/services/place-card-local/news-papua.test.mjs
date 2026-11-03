import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  fetchWorldPapuaNews,
  filterInternational,
  outletOf,
  parseWorldRss,
  WORLD_TOPICS,
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
  rssItem({
    title: 'West Papua court ruling draws international attention',
    source: 'Reuters',
  }),
  rssItem({ title: 'KNPB statement ahead of anniversary', source: 'BBC News' }),
  rssItem({ title: 'ULMWP leadership meets in Vanuatu', source: 'RNZ' }),
  rssItem({ title: 'Separatism fears rise in Papua', source: 'Kompas.com' }),
  rssItem({ title: 'Separatism fears rise in Papua', source: 'Al Jazeera' }),
  '</channel></rss>',
].join('');

test('parseWorldRss reads title, link, source, time and strips snippet HTML', () => {
  const items = parseWorldRss(FIXTURE_XML);
  assert.equal(items.length, 5);
  assert.equal(
    items[0].title,
    'West Papua court ruling draws international attention',
  );
  assert.equal(items[0].source, 'Reuters');
  assert.equal(items[0].snippet, 'A lead sentence about Papua.');
  assert.ok(Number.isFinite(items[0].publishedAt));
});

test('filterInternational keeps foreign outlets and drops domestic ones', () => {
  const items = parseWorldRss(FIXTURE_XML);
  const kept = filterInternational(items);
  assert.equal(kept.length, 4);
  assert.ok(
    kept.every((item) => item.outlet),
    'every kept item names its outlet',
  );
  assert.ok(!kept.some((item) => item.source === 'Kompas.com'));
  assert.equal(outletOf('Deutsche Welle'), 'Deutsche Welle');
  assert.equal(outletOf('The Guardian'), 'The Guardian');
  assert.equal(outletOf('Tribunnews'), null);
});

test('fetchWorldPapuaNews fetches each topic, dedups, sorts and caches', async () => {
  const cacheFile = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'gev-news-')),
    'cache.json',
  );
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, text: async () => FIXTURE_XML };
  };

  const first = await fetchWorldPapuaNews({
    topics: [WORLD_TOPICS[0], WORLD_TOPICS[1]],
    perTopic: 10,
    fetchImpl,
    cacheFile,
  });
  assert.equal(first.ok, undefined);
  assert.equal(first.scope, 'world');
  assert.equal(first.live, true);
  assert.equal(first.total, 4, 'domestic item is filtered out');
  assert.ok(
    first.items.every(
      (item) => item.topic === 'west-papua' || item.topic === 'knpb',
    ),
  );
  assert.equal(calls, 2);

  // Cache segar → tidak ada panggilan jaringan kedua.
  const second = await fetchWorldPapuaNews({
    topics: [WORLD_TOPICS[0]],
    fetchImpl,
    cacheFile,
  });
  assert.equal(second.total, first.total);
  assert.equal(calls, 2, 'a fresh cache skips the network');

  // force → jaringan dipanggil lagi, dan hasilnya disortir baru dulu.
  const third = await fetchWorldPapuaNews({
    topics: [WORLD_TOPICS[0]],
    fetchImpl,
    cacheFile,
    force: true,
  });
  assert.ok(calls >= 3);
  assert.equal(third.items.length, 4, 'same fixture, same dedup across topics');
});

test('a failing feed does not sink the other topics', async () => {
  const cacheFile = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'gev-news-')),
    'cache.json',
  );
  const fetchImpl = async (url) =>
    String(url).includes('KNPB')
      ? { ok: false, text: async () => '' }
      : { ok: true, text: async () => FIXTURE_XML };

  const result = await fetchWorldPapuaNews({
    topics: [WORLD_TOPICS[0], WORLD_TOPICS[1]],
    perTopic: 10,
    fetchImpl,
    cacheFile,
  });
  assert.equal(
    result.total,
    4,
    'the failed topic is skipped, the rest survive',
  );
});
