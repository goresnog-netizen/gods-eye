/**
 * Papua world news — berita luar negeri soal Papua.
 *
 * Google News RSS (keyless), edisi internasional (en-US), dicari dengan topik
 * yang relevan: West Papua, KNPB, ULMWP, Free Papua Movement, separatisme.
 * Hasilnya difilter ke outlet internasional (BBC, Reuters, AP, Guardian,
 * Al Jazeera, DW, France 24, ABC AU, RNZ, ...) — berita domestik Indonesia
 * bukan tujuan modul ini, dan filter itulah yang menjaganya.
 *
 * Cache disk 15 menit: feed berubah lambat dan panel menyentuh route ini
 * pada setiap klik tab. `GODSEYE_NEWS_CACHE` menimpa lokasi cache (test
 * menunjuknya ke tmp dir).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const DEFAULT_CACHE_FILE = path.join(ROOT, '.gev-cache/news-world.json');

/** Nama file cache untuk satu kombinasi query, di-hash agar berbeda per query. */
export function worldNewsCacheFile(signature) {
  let hash = 5381;
  for (const char of String(signature)) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return path.join(
    path.dirname(DEFAULT_CACHE_FILE),
    `news-world-${(hash >>> 0).toString(36)}.json`,
  );
}

const GNEWS_ENDPOINT = 'https://news.google.com/rss/search';
const NEWS_HEADERS = {
  'User-Agent': 'GodsEye/1.0 (local research console, world news feed)',
};

/** Topik default yang dicari. `id` dipakai route sebagai `?topic=`; `query`
 * adalah apa yang dikirim ke Google News. */
export const WORLD_TOPICS = Object.freeze([
  { id: 'west-papua', label: 'West Papua', query: '"West Papua"' },
  { id: 'knpb', label: 'KNPB', query: 'KNPB Papua' },
  { id: 'ulmwp', label: 'ULMWP', query: 'ULMWP Papua' },
  {
    id: 'free-papua',
    label: 'Free Papua Movement',
    query: '"Free Papua Movement"',
  },
  { id: 'separatism', label: 'Papua separatism', query: 'Papua separatism' },
  {
    id: 'conflict',
    label: 'Papua conflict',
    query: 'Papua conflict Indonesia',
  },
]);

/**
 * Outlet internasional yang dipertahankan. `match` diuji sebagai substring
 * (lowercase) dari nama sumber di tag `<source>` feed. Nama itu adalah satu
 * satunya identitas outlet yang RSS kasih — link Google News tidak memuat
 * domain penerbitnya.
 */
const INTERNATIONAL_OUTLETS = Object.freeze([
  { name: 'BBC', match: ['bbc'] },
  { name: 'Reuters', match: ['reuters'] },
  { name: 'Associated Press', match: ['associated press', 'ap news'] },
  { name: 'The Guardian', match: ['the guardian'] },
  { name: 'Al Jazeera', match: ['al jazeera'] },
  { name: 'Deutsche Welle', match: ['deutsche welle', 'dw news'] },
  { name: 'France 24', match: ['france 24'] },
  { name: 'Voice of America', match: ['voice of america'] },
  { name: 'ABC News (Australia)', match: ['abc news (australia)'] },
  { name: 'RNZ', match: ['rnz'] },
  { name: 'South China Morning Post', match: ['south china morning post'] },
  { name: 'The Straits Times', match: ['straits times'] },
  { name: 'The Japan Times', match: ['japan times'] },
  { name: 'The New York Times', match: ['new york times'] },
  { name: 'The Washington Post', match: ['washington post'] },
  { name: 'CNA', match: ['channel news asia', 'cna'] },
  { name: 'BenarNews', match: ['benarnews'] },
  { name: 'The Economist', match: ['the economist'] },
]);

const CACHE_TTL_MS = 15 * 60 * 1000;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tagValue(block, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(
    block,
  );
  if (!match) return '';
  return decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

/** Snippet (description) tanpa markup HTML. */
function snippetOf(block) {
  const raw = tagValue(block, 'description').trim();
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse item RSS dari Google News menjadi bentuk panel. Murni, untuk test. */
export function parseWorldRss(xml) {
  const blocks = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks
    .map((block) => {
      const pubDate = tagValue(block, 'pubDate').trim();
      const published = pubDate ? Date.parse(pubDate) : Number.NaN;
      return {
        title: tagValue(block, 'title').trim(),
        link: tagValue(block, 'link').trim(),
        source: tagValue(block, 'source').trim() || 'unknown',
        snippet: snippetOf(block),
        publishedAt: Number.isFinite(published) ? published : null,
      };
    })
    .filter((item) => item.title);
}

/** Nama outlet internasional untuk sebuah item, atau null bila bukan. Murni. */
export function outletOf(sourceName) {
  const name = String(sourceName || '').toLowerCase();
  if (!name) return null;
  for (const outlet of INTERNATIONAL_OUTLETS) {
    if (outlet.match.some((needle) => name.includes(needle))) {
      return outlet.name;
    }
  }
  return null;
}

/** Buang item yang bukan dari outlet internasional. Murni, untuk test. */
export function filterInternational(items) {
  return items
    .map((item) => {
      const outlet = outletOf(item.source);
      if (!outlet) return null;
      return { ...item, outlet };
    })
    .filter(Boolean);
}

/** Kunci dedup: judul dinormalisasi, 80 karakter pertama. */
function dedupKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

async function readCache(file) {
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    if (cached?.at && Date.now() - cached.at < CACHE_TTL_MS && cached.payload) {
      return cached.payload;
    }
  } catch {
    /* no cache yet, or a broken one */
  }
  return null;
}

async function writeCache(file, payload) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    // Nama tmp unik per proses: dua penulis yang saling timpa tidak boleh
    // menabrak rename satu sama lain (pelajaran round 18b).
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ at: Date.now(), payload }));
    await rename(tmp, file);
  } catch {
    /* a failed cache write is not worth failing the request */
  }
}

/** Satu query Google News → item internasional yang sudah di-shape. */
async function fetchTopic(topic, fetchImpl, { perQuery, topicsSeen }) {
  const url = `${GNEWS_ENDPOINT}?q=${encodeURIComponent(topic.query)}&hl=en&gl=US&ceid=US:en`;
  const response = await fetchImpl(url, { headers: NEWS_HEADERS });
  if (!response.ok) return [];
  const xml = await response.text();
  const items = [];
  for (const item of filterInternational(parseWorldRss(xml)).slice(
    0,
    perQuery,
  )) {
    const key = dedupKey(item.title);
    if (topicsSeen.has(key)) continue;
    topicsSeen.add(key);
    items.push({ ...item, topic: topic.id, query: topic.query });
  }
  return items;
}

/**
 * Berita luar negeri tentang Papua, dari Google News RSS (keyless).
 *
 * Cache disk per kombinasi query: pencarian KNPB dan pencarian ULMWP adalah
 * dua feed yang berbeda, dan satu file cache global akan menjawab query kedua
 * dengan hasil query pertama — siluman yang menyamar sebagai kebaruan.
 *
 * @param {object} [options]
 * @param {Array<{id:string,label:string,query:string}>} [options.topics]
 * @param {number} [options.perTopic] - item maksimal per topik
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.cacheFile] - timpa lokasi cache disk
 * @param {boolean} [options.force] - abaikan cache (refresh)
 */
export async function fetchWorldPapuaNews(options = {}) {
  const {
    topics = WORLD_TOPICS,
    perTopic = 10,
    fetchImpl = (...args) => fetch(...args),
    cacheFile = process.env.GODSEYE_NEWS_CACHE ||
      worldNewsCacheFile(topics.map((topic) => topic.query).join('|')),
    force = false,
  } = options;

  if (!force) {
    const cached = await readCache(cacheFile);
    if (cached) return cached;
  }

  const topicsSeen = new Set();
  const allItems = [];
  for (const topic of topics) {
    try {
      const items = await fetchTopic(topic, fetchImpl, {
        perQuery: perTopic,
        topicsSeen,
      });
      allItems.push(...items);
    } catch {
      // Satu topik yang gagal tidak boleh menenggelamkan yang lain.
    }
  }
  allItems.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  const payload = {
    scope: 'world',
    live: true,
    generatedAt: Date.now(),
    source: 'google-news-rss-keyless',
    topics: topics.map((topic) => topic.id),
    total: allItems.length,
    items: allItems,
  };
  await writeCache(cacheFile, payload);
  return payload;
}

/** Daerah publik: apakah cache masih segar (dipakai status panel). */
export function cacheTtlMs() {
  return CACHE_TTL_MS;
}
