/**
 * Indonesia News Feed — lokal, tanpa external provider calls.
 * Menggunakan Google News RSS (keyless) untuk berita Indonesia & Papua.
 * Output: JSON file lokal + CLI.
 */

const GNEWS_ENDPOINT = 'https://news.google.com/rss/search';

const DEFAULT_QUERIES = [
  'Indonesia Papua',
  'Papua Indonesia keamanan',
  'Indonesia ekonomi',
  'Papua pembangunan',
  'Indonesia geopolitik',
  'Jayapura Papua',
  'Sorong Papua',
  'Manokwari Papua',
  'Merauke Papua',
  'Timika Papua',
  'Tolikara Papua',
  'Yahukimo Papua',
  'Puncak Jaya Papua',
];

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

function parseRss(xml) {
  const blocks = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks
    .map((block) => {
      const pubDate = tagValue(block, 'pubDate').trim();
      const published = pubDate ? Date.parse(pubDate) : Number.NaN;
      return {
        title: tagValue(block, 'title').trim(),
        link: tagValue(block, 'link').trim(),
        source: tagValue(block, 'source').trim() || 'unknown',
        publishedAt: Number.isFinite(published) ? published : null,
      };
    })
    .filter((item) => item.title);
}

/**
 * Fetch berita Indonesia/Papua dari Google News RSS (keyless).
 *
 * @param {object} [options]
 * @param {string[]} [options.queries] - custom queries
 * @param {number} [options.perQuery] - max items per query
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function fetchIndonesiaNews(options = {}) {
  const {
    queries = DEFAULT_QUERIES,
    perQuery = 10,
    fetchImpl = (...args) => fetch(...args),
  } = options;

  const NEWS_HEADERS = { 'User-Agent': 'GodsEye/1.0 (local research console)' };
  const allItems = [];
  const seen = new Set();

  for (const query of queries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id-ID&gl=ID&ceid=ID:id`;
      const response = await fetchImpl(url, { headers: NEWS_HEADERS });
      if (!response.ok) continue;
      const xml = await response.text();
      const items = parseRss(xml).slice(0, perQuery);
      for (const item of items) {
        const key = item.title.toLowerCase().slice(0, 60);
        if (seen.has(key)) continue;
        seen.add(key);
        allItems.push({ ...item, query });
      }
    } catch {
      // silently skip failed queries
    }
  }

  // Sort by publishedAt (newest first)
  allItems.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  return {
    generatedAt: Date.now(),
    count: allItems.length,
    queries: queries.length,
    items: allItems,
    source: 'google-news-rss-keyless',
  };
}
