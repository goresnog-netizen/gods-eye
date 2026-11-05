/**
 * Papua news — gabungan berita internasional (en-US) dan domestik Indonesia (id-ID).
 *
 * Dua jalur paralel:
 *   • World  — Google News RSS (en-US), topik global: West Papua, KNPB, ULMWP,
 *              OPM, Benny Wenda, Morning Star Flag, Free Papua, separatisme, konflik.
 *              Difilter ke outlet internasional (BBC, Reuters, AP, Guardian,
 *              Al Jazeera, DW, France 24, ABC AU, RNZ, BenarNews, dll).
 *
 *   • Domestic — Google News RSS (id-ID), topik lokal Indonesia: konflik Papua,
 *              kemerdekaan Papua, OPM, Benny Wenda, ULMWP, separatisme Papua, dll.
 *              Difilter ke outlet Indonesia (Kompas, Detik, Tempo, CNN Indonesia,
 *              Tirto, Mongabay, BenarNews, dll) DAN outlet internasional yang
 *              menulis dalam bahasa Indonesia atau tentang Indonesia.
 *
 * Hasil digabung, di-dedup, diurut dari terbaru ke terlama.
 *
 * Cache disk 15 menit: `GODSEYE_NEWS_CACHE` menimpa lokasi cache (test
 * menunjuknya ke tmp dir).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const DEFAULT_CACHE_FILE = path.join(ROOT, '.gev-cache/news-papua.json');

export function papuaNewsCacheFile(signature) {
  let hash = 5381;
  for (const char of String(signature)) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return path.join(
    path.dirname(DEFAULT_CACHE_FILE),
    `news-papua-${(hash >>> 0).toString(36)}.json`,
  );
}

/** Backwards compat — redirect old world-only cache key. */
export function worldNewsCacheFile(signature) {
  return papuaNewsCacheFile(signature);
}

const GNEWS_ENDPOINT = 'https://news.google.com/rss/search';
const NEWS_HEADERS = {
  'User-Agent': 'GodsEye/1.0 (local research console)',
};

// ─── Topics ──────────────────────────────────────────────────────────────────

/** Topik internasional (en-US). */
export const WORLD_TOPICS = Object.freeze([
  { id: 'west-papua', label: 'West Papua', query: '"West Papua"' },
  { id: 'knpb', label: 'KNPB', query: 'KNPB Papua' },
  { id: 'ulmwp', label: 'ULMWP', query: 'ULMWP Papua' },
  { id: 'opm', label: 'OPM', query: 'OPM Papua separatists' },
  { id: 'benny-wenda', label: 'Benny Wenda', query: 'Benny Wenda Papua' },
  {
    id: 'morning-star',
    label: 'Morning Star Flag',
    query: '"Morning Star Flag" Papua',
  },
  {
    id: 'free-papua',
    label: 'Free Papua Movement',
    query: '"Free Papua Movement"',
  },
  { id: 'separatism', label: 'Papua separatism', query: 'Papua separatism' },
  {
    id: 'papua-conflict',
    label: 'Papua conflict',
    query: 'Papua conflict Indonesia',
  },
  {
    id: 'west-papua-independence',
    label: 'West Papua independence',
    query: 'West Papua independence',
  },
]);

/** Topik domestik Indonesia (id-ID). */
export const DOMESTIC_TOPICS = Object.freeze([
  { id: 'konflik-papua', label: 'Konflik Papua', query: 'konflik papua' },
  {
    id: 'kemerdekaan-papua',
    label: 'Kemerdekaan Papua',
    query: 'kemerdekaan papua',
  },
  { id: 'opm-dom', label: 'OPM', query: 'OPM papua' },
  { id: 'benny-wenda-dom', label: 'Benny Wenda', query: 'benny wenda papua' },
  { id: 'ulmwp-dom', label: 'ULMWP', query: 'ulmwp papua' },
  { id: 'separatis-papua', label: 'Separatis Papua', query: 'separatis papua' },
  { id: 'militan-papua', label: 'Militan Papua', query: 'militan papua' },
  { id: 'tnipapua', label: 'TNI Papua', query: 'tni papua' },
  { id: 'guerilla-papua', label: 'Guerilla Papua', query: 'guerilla papua' },
  {
    id: 'pembebasan-papua',
    label: 'Pembebasan Papua',
    query: 'pembebasan papua',
  },
  { id: 'knpb-dom', label: 'KNPB', query: 'knpb papua' },
  { id: 'west-papua-dom', label: 'West Papua', query: 'west papua' },
]);

// ─── Outlet allowlists ────────────────────────────────────────────────────────

const INTERNATIONAL_OUTLETS = Object.freeze([
  { name: 'BBC', match: ['bbc'] },
  { name: 'Reuters', match: ['reuters'] },
  { name: 'Associated Press', match: ['associated press', 'ap news'] },
  { name: 'The Guardian', match: ['the guardian'] },
  { name: 'Al Jazeera', match: ['al jazeera'] },
  { name: 'Deutsche Welle', match: ['deutsche welle', 'dw news', 'dw.com'] },
  { name: 'France 24', match: ['france 24'] },
  { name: 'Voice of America', match: ['voice of america'] },
  {
    name: 'ABC News (Australia)',
    match: ['abc news (australia)', 'abc.net.au'],
  },
  { name: 'RNZ', match: ['rnz', 'radionz'] },
  { name: 'SCMP', match: ['south china morning post'] },
  { name: 'The Straits Times', match: ['straits times'] },
  { name: 'The Japan Times', match: ['japan times'] },
  { name: 'The New York Times', match: ['new york times'] },
  { name: 'The Washington Post', match: ['washington post'] },
  { name: 'CNA', match: ['channel news asia', 'cna'] },
  { name: 'BenarNews', match: ['benarnews'] },
  { name: 'The Economist', match: ['the economist'] },
  { name: 'Sydney Morning Herald', match: ['sydney morning herald'] },
  { name: 'The Age', match: ['the age'] },
  { name: 'Nikkei Asia', match: ['nikkei'] },
  { name: 'Asia Pacific Report', match: ['asiapacificreport'] },
  { name: 'Pacific Islands Report', match: ['pacific islands report'] },
  { name: 'The Independent', match: ['independent.co.uk'] },
  { name: 'The Diplomat', match: ['thediplomat'] },
  { name: 'Kompas', match: ['kompas'] },
  { name: 'Tempo', match: ['tempo'] },
  { name: 'BenarNews ID', match: ['benarnews'] },
]);

/** Outlet Indonesia untuk feed domestik (hl=id, gl=ID). */
const DOMESTIC_OUTLETS = Object.freeze([
  // Berita nasional utama
  { name: 'Kompas.com', match: ['kompas.com', 'kompas'] },
  { name: 'Detik.com', match: ['detik.com', 'detiknews'] },
  { name: 'CNN Indonesia', match: ['cnnindonesia.com', 'cnn indonesia'] },
  { name: 'Tempo.co', match: ['tempo.co', 'tempo'] },
  { name: 'Tirto.id', match: ['tirto.id'] },
  { name: 'CNN Indonesia', match: ['cnnindonesia.com'] },
  // Media khusus Indonesia Timur / Papua
  { name: 'BenarNews', match: ['benarnews.com', 'benarnews'] },
  { name: 'Jubi.com', match: ['jubi.com', 'jubi'] },
  { name: 'Suara Papua', match: ['suara papua'] },
  { name: 'Papua Barat News', match: ['papua barat'] },
  { name: 'Cenderawasih Pos', match: ['cenderawasih'] },
  { name: 'Harian Papua', match: ['harian papua'] },
  // Media lingkungan & investigasi
  { name: 'Mongabay', match: ['mongabay.co.id', 'mongabay'] },
  { name: 'The Jakarta Post', match: ['thejakartapost.com', 'jakarta post'] },
  // Internasional yang liputan Indonesia kuat
  { name: 'BBC Indonesia', match: ['bbc.com/indonesia', 'bbc indonesia'] },
  { name: 'AFP', match: ['afp', 'agence france-presse'] },
  { name: 'AP Indonesia', match: ['apnews.co.id', 'ap news'] },
  {
    name: 'Reuters Indonesia',
    match: ['reuters.com/indonesia', 'reuters indonesia'],
  },
  // Agregator & media digital
  { name: 'Okezone', match: ['okezone.com'] },
  { name: 'Tribunnews', match: ['tribunnews.com'] },
  { name: 'Sindonews', match: ['sindonews.com'] },
  { name: 'Antara', match: ['antara'] },
  { name: 'Liputan6', match: ['liputan6.com'] },
  // Radio / TV
  { name: 'RRI', match: ['rri.co.id'] },
  { name: 'TVRI', match: ['tvri.co.id'] },
  { name: 'KBR', match: ['kbr.id', 'kbr'] },
]);

const CACHE_TTL_MS = 15 * 60 * 1000;

// ─── Core helpers ─────────────────────────────────────────────────────────────

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

function snippetOf(block) {
  const raw = tagValue(block, 'description').trim();
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 80);
}

// ─── RSS parsing ─────────────────────────────────────────────────────────────

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

/** Legacy alias */
export const parseRss = parseWorldRss;

// ─── Outlet classification ────────────────────────────────────────────────────

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

/** Nama outlet Indonesia untuk sebuah item, atau null. Murni. */
export function domesticOutletOf(sourceName) {
  const name = String(sourceName || '').toLowerCase();
  if (!name) return null;
  for (const outlet of DOMESTIC_OUTLETS) {
    if (outlet.match.some((needle) => name.includes(needle))) {
      return outlet.name;
    }
  }
  return null;
}

/** Classify outlet — returns 'international' | 'domestic' | 'other'. Murni. */
export function classifyOutlet(sourceName) {
  return outletOf(sourceName)
    ? 'international'
    : domesticOutletOf(sourceName)
      ? 'domestic'
      : 'other';
}

/** Buang item yang bukan dari outlet yang diperbolehkan. Murni.
 *  scope sudah diset oleh fetchTopic; pertahankan. */
export function filterInternational(items) {
  return items
    .map((item) => {
      const outlet = outletOf(item.source);
      if (!outlet) return null;
      return { ...item, outlet };
    })
    .filter(Boolean);
}

/** Buang item yang bukan dari outlet Indonesia. Murni. */
export function filterDomestic(items) {
  return items
    .map((item) => {
      const outlet = domesticOutletOf(item.source);
      if (!outlet) return null;
      return { ...item, outlet };
    })
    .filter(Boolean);
}

/** Terima semua item yang punya outlet internasional ATAU Indonesia. Murni.
 *  Jika item sudah punya scope (dari fetchTopic), pertahankan; jika belum,
 *  set berdasarkan outlet yang ditemukan. */
export function filterAllowed(items) {
  return items
    .map((item) => {
      const intl = outletOf(item.source);
      const dom = domesticOutletOf(item.source);
      const outlet = intl || dom;
      if (!outlet) return null;
      return {
        ...item,
        outlet,
        scope: item.scope || (intl ? 'international' : 'domestic'),
      };
    })
    .filter(Boolean);
}

// ─── Cache ───────────────────────────────────────────────────────────────────

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
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ at: Date.now(), payload }));
    await rename(tmp, file);
  } catch {
    /* a failed cache write is not worth failing the request */
  }
}

// ─── Fetch one Google News topic ──────────────────────────────────────────────

/**
 * Fetch satu topik dari Google News dengan hl/gl tertentu.
 * @param {object} topic - { id, label, query }
 * @param {string} hl - language code (en / id)
 * @param {string} gl - country code (US / ID)
 * @param {Function} fetchImpl
 * @param {object} opts
 */
async function fetchTopic(topic, hl, gl, fetchImpl, { perQuery, topicsSeen }) {
  const url = `${GNEWS_ENDPOINT}?q=${encodeURIComponent(topic.query)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl}`;
  try {
    const response = await fetchImpl(url, { headers: NEWS_HEADERS });
    if (!response.ok) return [];
    const xml = await response.text();
    const raw = parseWorldRss(xml);
    const filtered =
      hl === 'id' ? filterDomestic(raw) : filterInternational(raw);
    const items = [];
    for (const item of filtered.slice(0, perQuery)) {
      const key = dedupKey(item.title);
      if (topicsSeen.has(key)) continue;
      topicsSeen.add(key);
      items.push({
        ...item,
        topic: topic.id,
        query: topic.query,
        lang: hl,
        scope: hl === 'id' ? 'domestic' : 'international',
      });
    }
    return items;
  } catch {
    return [];
  }
}

// ─── World news (en-US, international outlets) ────────────────────────────────

/** Fetch topik internasional, outlet internasional. */
export async function fetchWorldPapuaNews(options = {}) {
  const {
    topics = WORLD_TOPICS,
    perTopic = 8,
    fetchImpl = (...args) => fetch(...args),
    cacheFile = process.env.GODSEYE_NEWS_CACHE ||
      worldNewsCacheFile(topics.map((t) => t.query).join('|')),
    force = false,
  } = options;

  if (!force) {
    const cached = await readCache(cacheFile);
    if (cached) return cached;
  }

  const topicsSeen = new Set();
  const allItems = [];
  for (const topic of topics) {
    const items = await fetchTopic(topic, 'en', 'US', fetchImpl, {
      perQuery: perTopic,
      topicsSeen,
    });
    allItems.push(...items);
  }
  allItems.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  const payload = {
    scope: 'world',
    live: true,
    generatedAt: Date.now(),
    source: 'google-news-rss-keyless',
    topics: topics.map((t) => t.id),
    total: allItems.length,
    items: allItems,
  };
  await writeCache(cacheFile, payload);
  return payload;
}

// ─── Domestic news (id-ID, Indonesian outlets) ───────────────────────────────

/** Fetch topik domestik, outlet Indonesia. */
export async function fetchDomesticPapuaNews(options = {}) {
  const {
    topics = DOMESTIC_TOPICS,
    perTopic = 8,
    fetchImpl = (...args) => fetch(...args),
    force = false,
  } = options;

  const cacheFile =
    process.env.GODSEYE_NEWS_CACHE ||
    papuaNewsCacheFile('dom|' + topics.map((t) => t.query).join('|'));

  if (!force) {
    const cached = await readCache(cacheFile);
    if (cached) return cached;
  }

  const topicsSeen = new Set();
  const allItems = [];
  for (const topic of topics) {
    const items = await fetchTopic(topic, 'id', 'ID', fetchImpl, {
      perQuery: perTopic,
      topicsSeen,
    });
    allItems.push(...items);
  }
  allItems.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  const payload = {
    scope: 'domestic',
    live: true,
    generatedAt: Date.now(),
    source: 'google-news-rss-keyless',
    topics: topics.map((t) => t.id),
    total: allItems.length,
    items: allItems,
  };
  await writeCache(cacheFile, payload);
  return payload;
}

// ─── Unified Papua news ───────────────────────────────────────────────────────

/**
 * Berita Papua lengkap: internasional + domestik Indonesia.
 * Parallel fetch, unified dedup, sorted newest-first.
 *
 * @param {object} [options]
 * @param {number} [options.perTopic] - item maksimal per topik per feed
 * @param {typeof fetch} [options.fetchImpl]
 * @param {boolean} [options.force] - abaikan cache
 * @param {'all'|'international'|'domestic'} [options.scope] - filter scope
 */
export async function fetchPapuaNews(options = {}) {
  const {
    perTopic = 8,
    fetchImpl = (...args) => fetch(...args),
    force = false,
    scope = 'all',
  } = options;

  const cacheFile =
    process.env.GODSEYE_NEWS_CACHE ||
    papuaNewsCacheFile(
      `all|${perTopic}|${scope}|${JSON.stringify(WORLD_TOPICS.map((t) => t.id))}|${JSON.stringify(DOMESTIC_TOPICS.map((t) => t.id))}`,
    );

  // Top-level cache is checked FIRST — if hit, skip individual feed calls entirely.
  // This is the only cache key callers get; individual feed cache files are an
  // optimization internal to the fetch but do not serve external requests.
  const cached = await readCache(cacheFile);
  if (cached && !force) return cached;

  // Parallel fetch both feeds (force flows through)
  const [world, domestic] = await Promise.all([
    fetchWorldPapuaNews({ topics: WORLD_TOPICS, perTopic, fetchImpl, force }),
    fetchDomesticPapuaNews({
      topics: DOMESTIC_TOPICS,
      perTopic,
      fetchImpl,
      force,
    }),
  ]);

  // Merge items, unified dedup
  const seen = new Set();
  const merged = [];

  for (const item of [...world.items, ...domestic.items]) {
    const key = dedupKey(item.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  // Sort newest-first
  merged.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  // Apply scope filter
  const filtered =
    scope === 'all' ? merged : merged.filter((item) => item.scope === scope);

  const payload = {
    scope,
    live: true,
    generatedAt: Date.now(),
    source: 'google-news-rss-keyless',
    worldTopics: WORLD_TOPICS.map((t) => t.id),
    domesticTopics: DOMESTIC_TOPICS.map((t) => t.id),
    total: filtered.length,
    worldTotal: world.total,
    domesticTotal: domestic.total,
    items: filtered,
  };
  await writeCache(cacheFile, payload);
  return payload;
}

/** Convenience: fetch international only (backwards compat for tests). */
export async function fetchInternationalNews(options = {}) {
  return fetchPapuaNews({ ...options, scope: 'international' });
}

/** Convenience: fetch domestic only. */
export async function fetchDomesticNews(options = {}) {
  return fetchPapuaNews({ ...options, scope: 'domestic' });
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export function cacheTtlMs() {
  return CACHE_TTL_MS;
}
