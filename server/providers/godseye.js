import { buildGoldImpact, formatGoldReport } from './godseye/gold-impact.js';
import { buildPlaceCard } from './godseye/place-card.js';
import { handleChat } from './godseye/chat.js';
import { handleTarget } from './godseye/target.js';
import { searchWeb } from './godseye/search.js';
import { loadSkillLibrary } from './godseye/skill-library.js';
import { REGION_PRESETS } from './godseye/regions.js';
import { installLocalIntel } from './godseye/local-intel.js';

/**
 * Cache the market feed briefly: the panel refreshes on a timer and the
 * upstream sources are public endpoints that answer slowly.
 */
const GOLD_FEED_TTL_MS = 60_000;
const goldCache = { at: 0, payload: null };

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

function positiveInteger(value, fallback, ceiling) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(ceiling, Math.floor(parsed));
}

/**
 * Connect the God's Eye analysis routes to development and preview.
 *
 * GET  /api/godseye/gold-impact?top=8&format=json|text
 * GET  /api/godseye/place-card?query=Madrid&radiusKm=20
 * POST /api/godseye/chat
 * GET  /api/godseye/target?target=Madrid&radiusKm=25
 * GET  /api/godseye/search?q=gold+price
 */
export function godseyeProxy(options = {}) {
  const { cacheTtlMs = GOLD_FEED_TTL_MS } = options;
  function install(server) {
    server.middlewares.use('/api/godseye/gold-impact', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      const top = positiveInteger(url.searchParams.get('top'), 10, 50);
      const now = Date.now();
      if (goldCache.payload && now - goldCache.at < cacheTtlMs) {
        const cached = goldCache.payload;
        if (url.searchParams.get('format') === 'text') {
          return sendText(res, 200, formatGoldReport(cached));
        }
        return sendJson(res, 200, cached);
      }
      try {
        const feed = await buildGoldImpact({ top });
        goldCache.at = now;
        goldCache.payload = feed;
        if (url.searchParams.get('format') === 'text') {
          return sendText(res, 200, formatGoldReport(feed));
        }
        return sendJson(res, 200, feed);
      } catch (error) {
        return sendJson(res, 502, {
          ok: false,
          error: 'upstream_unreachable',
          detail: error?.message || 'the feed could not be built',
        });
      }
    });

    server.middlewares.use('/api/godseye/place-card', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      const query = String(url.searchParams.get('query') || '').trim();
      if (!query) {
        return sendJson(res, 400, {
          ok: false,
          error: 'query_required',
          hint: 'Pass ?query=Madrid',
        });
      }
      const radiusKm = positiveInteger(
        url.searchParams.get('radiusKm'),
        25,
        200,
      );
      try {
        const card = await buildPlaceCard(query, { radiusKm });
        return sendJson(res, 200, { ok: true, ...card });
      } catch (error) {
        const notFound = error?.code === 'not_found';
        return sendJson(res, notFound ? 404 : 502, {
          ok: false,
          error: notFound ? 'not_found' : 'upstream_unreachable',
          detail: error?.message || 'the place card could not be built',
        });
      }
    });

    // The task chat: the server-side privacy guard decides what may leave the
    // machine, so the panel only sends the message and an optional scene.
    server.middlewares.use('/api/godseye/chat', async (req, res) => {
      try {
        await handleChat(req, res);
      } catch (error) {
        return sendJson(res, 502, {
          ok: false,
          error: 'upstream_unreachable',
          detail: error?.message || 'the chat could not be answered',
        });
      }
    });

    server.middlewares.use('/api/godseye/target', async (req, res) => {
      try {
        await handleTarget(req, res);
      } catch (error) {
        return sendJson(res, 502, {
          ok: false,
          error: 'upstream_unreachable',
          detail: error?.message || 'the target profile could not be built',
        });
      }
    });

    server.middlewares.use('/api/godseye/search', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      const query = String(url.searchParams.get('q') || '').trim();
      if (!query) {
        return sendJson(res, 400, {
          ok: false,
          error: 'query_required',
          hint: 'Pass ?q=gold+price',
        });
      }
      const limit = positiveInteger(url.searchParams.get('limit'), 8, 25);
      try {
        const found = await searchWeb(query, { limit });
        return sendJson(res, 200, { ok: true, query, ...found });
      } catch (error) {
        return sendJson(res, 502, {
          ok: false,
          error: 'upstream_unreachable',
          detail: error?.message || 'the search could not be answered',
        });
      }
    });

    // The planted skill library: the modules the console knows, so the panel
    // can show what is available before a task is typed.
    server.middlewares.use('/api/godseye/skills', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      try {
        const library = await loadSkillLibrary();
        return sendJson(res, 200, {
          ok: true,
          version: library?.version ?? null,
          modules: Array.isArray(library?.modules) ? library.modules : [],
        });
      } catch (error) {
        return sendJson(res, 502, {
          ok: false,
          error: 'upstream_unreachable',
          detail: error?.message || 'the skill library could not be read',
        });
      }
    });

    // The region presets the panel offers. The hints are geocoder queries, so
    // they come from the server and are never translated.
    server.middlewares.use('/api/godseye/regions', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      return sendJson(res, 200, { ok: true, regions: REGION_PRESETS });
    });

    // The local intelligence routes: the CCTV catalog, target and cell
    // location, adaptive scoring and the local exports. They read the local
    // catalogs only, so nothing here reaches a provider.
    installLocalIntel(server);
  }
  return {
    name: 'godseye-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
