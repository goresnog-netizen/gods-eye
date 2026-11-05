/**
 * API: /api/godseye/[...path]
 *
 * The panel talks to `/api/godseye/*`, and every one of those routes already
 * exists as a handler in `server/providers/godseye/local-intel.js`. They are
 * mounted onto a Vite dev server through `installLocalIntel(server)`, which
 * does nothing but call `server.middlewares.use(path, handler)`.
 *
 * So this function supplies that one method, captures the routes, and
 * dispatches by pathname. No route logic is reimplemented here: news, bts
 * (catalog, coverage, viewshed, cells), cctv, locate, score, anomaly and
 * export all run the same code the dev server runs, so a fix in one place is
 * a fix in both.
 *
 * Two things a serverless environment changes:
 *  - the filesystem is read-only except /tmp, so every cache directory is
 *    pointed at a writable path before the module graph loads;
 *  - nothing is long-lived, so an in-memory cache is per cold start (the
 *    handlers' own TTLs still apply within an instance).
 */

import os from 'node:os';
import path from 'node:path';

// Must run before `local-intel.js` is imported: its cache directories are read
// at call time, but the audit log resolves its path on first write, and a
// write to the read-only bundle root would fail the request rather than fall
// back. On Lambda only /tmp is writable.
const WRITABLE = process.env.VERCEL
  ? '/tmp/gev'
  : path.join(os.tmpdir(), 'gev-cache');

process.env.GEV_AUDIT_DIR ||= path.join(WRITABLE, 'audit');
process.env.GEV_DEM_DIR ||= path.join(WRITABLE, 'dem');
process.env.GEV_WORLDCOVER_DIR ||= path.join(WRITABLE, 'worldcover');
process.env.GEV_TILE_DIR ||= path.join(WRITABLE, 'tiles');

/** path → handler, filled once from the real installer. */
let routesPromise = null;

async function routes() {
  if (!routesPromise) {
    routesPromise = (async () => {
      const table = new Map();
      const server = {
        middlewares: {
          use(routePath, handler) {
            table.set(routePath, handler);
          },
        },
      };

      // Two installers own the /api/godseye/* surface:
      //  - local-intel: cctv, locate, score, anomaly, news, bts, export,
      //    imagery, verify, audit, capabilities, intel, stream, cctv-stream,
      //    location-request, locate-consent
      //  - godseye: gold-impact, place-card, chat, target, search, skills,
      //    regions
      // Mounting both is what makes this a drop-in for the dev server.
      const { installLocalIntel } = await import(
        '../../server/providers/godseye/local-intel.js'
      );
      installLocalIntel(server);

      const { godseyeProxy } = await import(
        '../../server/providers/godseye.js'
      );
      // `godseyeProxy()` is a Vite plugin: the routes live in `configureServer`.
      godseyeProxy().configureServer(server);

      return table;
    })();
  }
  return routesPromise;
}

export default async function handler(req, res) {
  let table;
  try {
    table = await routes();
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: false,
        error: 'provider_unavailable',
        detail: error?.message || 'the local intel provider did not load',
      }),
    );
    return;
  }

  // `req.url` carries the path and query. Strip the trailing slash so
  // `/api/godseye/bts/` answers like `/api/godseye/bts`.
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  const route = table.get(pathname);
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: false,
        error: 'unknown_route',
        detail: `${pathname} is not one of the local intel routes`,
        routes: [...table.keys()].sort(),
      }),
    );
    return;
  }

  // The handlers read `req.url` themselves and write the response. They are
  // async and already catch their own failures, but a throw here must not
  // escape as an unhandled rejection.
  try {
    await route(req, res);
  } catch (error) {
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: false,
          error: 'route_failed',
          detail: error?.message || 'the route threw',
        }),
      );
    }
  }
}
