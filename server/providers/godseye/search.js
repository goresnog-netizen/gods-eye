/**
 * The search seam.
 *
 * A local SearXNG instance answers first, because it is the only source that
 * searches the whole web. When that instance cannot be reached the seam falls
 * back to the keyless Google News RSS feed this project already uses, so a
 * panel never shows an error for a missing search box: it shows fewer
 * results and says which engine produced them.
 *
 * The seam sends the query and nothing else. No cookie, no identifier, no
 * result is written to disk.
 */

import { parseRss } from './news.js';

/** Where the local instance listens when the operator did not say otherwise. */
const DEFAULT_SEARXNG_URL = 'http://127.0.0.1:8080';

/** A panel that waits forever is worse than a panel that says "unavailable". */
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 12;

/** Answers live five minutes: long enough to survive a panel refresh. */
const CACHE_TTL_MS = 300_000;
const CACHE_MAX_ENTRIES = 64;

const SEARXNG_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'GodsEye/1.0 (local research console)',
};

const RSS_HEADERS = {
  Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (GodsEye/1.0; +local research console)',
};

const GNEWS_ENDPOINT = 'https://news.google.com/rss/search';

/** Answers, keyed by instance, query and limit. */
const cache = new Map();

/** Drop every cached answer. The test seam uses it; nothing else should. */
export function clearSearchCache() {
  cache.clear();
}

/**
 * The base URL of the local instance.
 *
 * @returns {string}
 */
export function searxngBaseUrl() {
  const configured = String(process.env.GEV_SEARXNG_URL || '').trim();
  const base = configured || DEFAULT_SEARXNG_URL;
  return base.replace(/\/+$/, '');
}

/** A short reason for a failure, safe to show and to log. */
function reason(error) {
  const message = String(error?.message || error || '').trim();
  return message ? message.slice(0, 120) : 'the source failed';
}

function readCache(key, now) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at >= CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function remember(key, payload, now) {
  cache.set(key, { at: now, payload });
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

/**
 * A fetch that carries a deadline and the caller's abort signal.
 *
 * @param {typeof fetch} fetchImpl
 * @param {number} timeoutMs
 * @param {AbortSignal} [signal]
 */
export function timedFetch(fetchImpl, timeoutMs, signal) {
  return async (url, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new Error(`the request timed out after ${timeoutMs} ms`),
      );
    }, timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read the JSON answer of a SearXNG instance.
 *
 * The instance answers `{ results: [...] }`; every entry carries the URL, the
 * title, a content snippet, the engine that found it and, sometimes, a date.
 *
 * @param {object} payload
 * @param {number} [limit]
 * @returns {Array<{title:string,url:string,snippet:string,source:string,publishedAt:number|null}>}
 */
export function parseSearxngResults(payload, limit = DEFAULT_LIMIT) {
  const raw = Array.isArray(payload?.results) ? payload.results : [];
  const results = [];
  for (const item of raw) {
    const url = String(item?.url || '').trim();
    if (!url) continue;
    results.push({
      title: String(item?.title || '').trim() || url,
      url,
      snippet: String(item?.content || '').trim(),
      source: String(item?.engine || '').trim() || hostOf(url),
      publishedAt: parseTime(item?.publishedDate),
    });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * The keyless fallback: headlines about the query.
 *
 * The RSS reader is the one this project already ships, so the fallback
 * understands the same feed as the news panel.
 */
async function fallbackSearch(text, { request, limit }) {
  const url = `${GNEWS_ENDPOINT}?q=${encodeURIComponent(text)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await request(url, {
    headers: RSS_HEADERS,
    redirect: 'error',
  });
  if (!response.ok) {
    const error = new Error(
      `the news fallback answered HTTP ${response.status}`,
    );
    error.code = 'upstream_error';
    throw error;
  }
  const xml = await response.text();
  return parseRss(xml)
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      url: item.link,
      snippet: '',
      source: item.source || 'news',
      publishedAt: item.publishedAt,
    }));
}

/**
 * Search the web through the seam.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {AbortSignal} [options.signal]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.baseUrl]
 * @returns {Promise<{engine:'searxng'|'fallback',ok:boolean,results:Array<object>,note:string}>}
 */
export async function searchWeb(query, options = {}) {
  const {
    limit = DEFAULT_LIMIT,
    signal,
    fetchImpl = (...args) => fetch(...args),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseUrl = searxngBaseUrl(),
    now = Date.now,
  } = options;
  const text = String(query || '').trim();
  if (!text) {
    return {
      engine: 'fallback',
      ok: false,
      results: [],
      note: 'the query is empty',
    };
  }
  const key = `${baseUrl}|${text}|${limit}`;
  const cached = readCache(key, now());
  if (cached) return cached;

  const request = timedFetch(fetchImpl, timeoutMs, signal);
  try {
    const url = `${baseUrl}/search?q=${encodeURIComponent(text)}&format=json`;
    const response = await request(url, {
      headers: SEARXNG_HEADERS,
      redirect: 'error',
    });
    if (!response.ok) {
      const error = new Error(
        `the local instance answered HTTP ${response.status}`,
      );
      error.code = 'upstream_error';
      throw error;
    }
    const payload = await response.json();
    const results = parseSearxngResults(payload, limit);
    const answer = {
      engine: 'searxng',
      ok: true,
      results,
      note: results.length
        ? 'the local instance answered'
        : 'the local instance answered with no results',
    };
    remember(key, answer, now());
    return answer;
  } catch (error) {
    const detail = reason(error);
    try {
      const results = await fallbackSearch(text, { request, limit });
      const answer = {
        engine: 'fallback',
        ok: true,
        results,
        note: `the local instance is unreachable (${detail}); the keyless news feed answered`,
      };
      if (results.length) remember(key, answer, now());
      return answer;
    } catch (fallbackError) {
      return {
        engine: 'fallback',
        ok: false,
        results: [],
        note: `search is unavailable: ${detail}; the news fallback failed (${reason(fallbackError)})`,
      };
    }
  }
}
