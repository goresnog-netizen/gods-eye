/**
 * Live headlines for the Gold Impact feed.
 *
 * Google News RSS needs no key and answers quickly. GDELT is a second source
 * that frequently answers 429 from a single IP, so it stays optional and its
 * failures never reach the feed.
 */

const GNEWS_ENDPOINT = 'https://news.google.com/rss/search';
const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** The questions the feed asks the news desk. */
export const DEFAULT_QUERIES = [
  'gold price',
  'Federal Reserve interest rates',
  'inflation CPI',
  'dollar index',
  'geopolitical conflict oil',
];

const NEWS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (GodsEye/1.0; +local research console)',
};

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

/**
 * Parse an RSS document into plain items.
 *
 * @param {string} xml
 * @returns {Array<{title:string,link:string,source:string,publishedAt:number|null}>}
 */
export function parseRss(xml) {
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
 * Fetch one query from Google News RSS.
 *
 * @param {string} query
 * @param {object} [options]
 */
export async function fetchGoogleNews(query, options = {}) {
  const {
    fetchImpl = (...args) => fetch(...args),
    limit = 12,
    lang = 'en-US',
    country = 'US',
  } = options;
  const url = `${GNEWS_ENDPOINT}?q=${encodeURIComponent(query)}&hl=${lang}&gl=${country}&ceid=${country}:${lang.slice(0, 2)}`;
  const response = await fetchImpl(url, { headers: NEWS_HEADERS });
  if (!response.ok) {
    const error = new Error(`gnews HTTP ${response.status}`);
    error.code = 'upstream_error';
    throw error;
  }
  const xml = await response.text();
  return parseRss(xml)
    .slice(0, limit)
    .map((item) => ({ ...item, query }));
}

/**
 * Fetch one query from GDELT. Optional: the caller may ignore its failure.
 *
 * @param {string} query
 * @param {object} [options]
 */
export async function fetchGdelt(query, options = {}) {
  const {
    fetchImpl = (...args) => fetch(...args),
    limit = 6,
    timespan = '1d',
  } = options;
  const url = `${GDELT_ENDPOINT}?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${limit}&timespan=${timespan}`;
  const response = await fetchImpl(url, { headers: NEWS_HEADERS });
  if (!response.ok) {
    const error = new Error(`gdelt HTTP ${response.status}`);
    error.code = 'upstream_error';
    throw error;
  }
  const data = await response.json();
  return (Array.isArray(data?.articles) ? data.articles : [])
    .map((article) => {
      const seen = article?.seendate
        ? Date.parse(
            String(article.seendate).replace(
              /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
              '$1-$2-$3T$4:$5:$6Z',
            ),
          )
        : Number.NaN;
      return {
        title: String(article?.title || '').trim(),
        link: article?.url || '',
        source: article?.domain || 'gdelt',
        publishedAt: Number.isFinite(seen) ? seen : null,
        query,
      };
    })
    .filter((item) => item.title);
}

/**
 * Collect headlines for every query. Duplicates and failing sources are
 * handled here so the feed stays simple.
 *
 * @param {object} [options]
 * @param {string[]} [options.queries]
 * @param {boolean} [options.includeGdelt]
 */
export async function fetchNews(options = {}) {
  const {
    queries = DEFAULT_QUERIES,
    includeGdelt = false,
    perQuery = 12,
  } = options;
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const items = await fetchGoogleNews(query, {
        ...options,
        limit: perQuery,
      });
      if (!includeGdelt) return items;
      try {
        return [
          ...items,
          ...(await fetchGdelt(query, { ...options, limit: 6 })),
        ];
      } catch {
        return items;
      }
    }),
  );
  const items = [];
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value);
    else
      failed.push({
        query: queries[index],
        error: result.reason?.message || 'failed',
      });
  });
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return { items: unique, failed, fetchedAt: Date.now() };
}
