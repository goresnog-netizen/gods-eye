/**
 * Target research: where a named target is, how much of it is online, and who
 * is around it.
 *
 * Three keyless sources answer independently — Nominatim for the position, the
 * search seam for the digital trace, Overpass for the nearby actors — and one
 * failing source never takes the others down with it: every block reports its
 * own status instead of the whole profile failing.
 *
 * Only what the question needs leaves the machine: the name of the target, and
 * the coordinates of the area around it.
 */

import { bboxAround, resolvePlace } from './place-card.js';
import { searchWeb, timedFetch } from './search.js';

const DEFAULT_RADIUS_KM = 25;
const MAX_RADIUS_KM = 100;
const NEARBY_LIMIT = 12;
const TOP_RESULT_LIMIT = 5;

/** A profile is fresh for five minutes; the panel refreshes on a timer. */
const PROFILE_CACHE_TTL_MS = 300_000;
const PROFILE_CACHE_MAX_ENTRIES = 32;

const SOURCE_TIMEOUT_MS = 8000;
/**
 * The Overpass deadline.
 *
 * A shared instance answers a city block in 20 to 50 seconds, so the deadline
 * is generous; an operator with a fast instance can shorten it.
 */
const OVERPASS_TIMEOUT_MS = Number(
  process.env.GEV_OVERPASS_TIMEOUT_MS || 75_000,
);
const OVERPASS_USER_AGENT = 'GodsEye/1.0 (local research console)';
/**
 * No public instance is contacted by default.
 *
 * The console runs the same rule as the rest of the app: an Overpass instance
 * has to be configured (`OVERPASS_UPSTREAMS`, or `GEV_OVERPASS_URL` for this
 * module alone). A public mirror is not a default, because it is a third
 * party and it is often unreachable.
 */
const OVERPASS_NOT_CONFIGURED =
  'no Overpass instance is configured (set OVERPASS_UPSTREAMS or GEV_OVERPASS_URL)';

const EARTH_RADIUS_KM = 6371.0088;

/** Profiles already built, keyed by target and radius. */
const profileCache = new Map();

/** A short reason for a failure, safe to show and to log. */
function reason(error) {
  const message = String(error?.message || error || '').trim();
  return message ? message.slice(0, 160) : 'the source failed';
}

/**
 * The Overpass instance to ask.
 *
 * An operator who configured the app's own Overpass chain gets that instance
 * first; `GEV_OVERPASS_URL` overrides it for this module alone. Without one
 * the block reports that it is unavailable instead of contacting a public
 * mirror.
 *
 * @returns {string|null}
 */
export function overpassUrl() {
  const configured = String(process.env.GEV_OVERPASS_URL || '').trim();
  if (configured) return configured;
  const upstreams = String(process.env.OVERPASS_UPSTREAMS || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  return upstreams.length ? upstreams[0] : null;
}

/**
 * Keep a radius inside the range the panel offers.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function clampRadiusKm(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.floor(parsed));
}

/**
 * A coordinate that is really a number.
 *
 * `Number(null)` is 0, so a missing coordinate would silently become a point
 * off the coast of Africa. Anything that is not a number is no coordinate.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function coordinate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The distance between two points on the globe, in kilometres.
 *
 * @param {{lat:number,lon:number}} from
 * @param {{lat:number,lon:number}} to
 * @returns {number}
 */
export function haversineKm(from, to) {
  const lat1 = coordinate(from?.lat);
  const lon1 = coordinate(from?.lon);
  const lat2 = coordinate(to?.lat);
  const lon2 = coordinate(to?.lon);
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) {
    return Number.NaN;
  }
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * The kind of entity an Overpass element is.
 *
 * @param {object} tags
 * @returns {string|null}
 */
export function entityKind(tags) {
  if (!tags) return null;
  const amenity = String(tags.amenity || '');
  if (
    amenity === 'school' ||
    amenity === 'university' ||
    amenity === 'college'
  ) {
    return 'school';
  }
  if (
    amenity === 'clinic' ||
    amenity === 'hospital' ||
    amenity === 'doctors' ||
    amenity === 'pharmacy'
  ) {
    return 'clinic';
  }
  if (tags.person) return 'person';
  if (tags.office) return 'office';
  if (tags.works) return 'works';
  if (tags.shop) return 'shop';
  if (tags.building) return 'building';
  if (tags.man_made) return 'man_made';
  if (amenity) return 'amenity';
  return null;
}

/**
 * The point an Overpass element stands at.
 *
 * A node carries its own coordinates; a way and a relation carry the centre
 * the instance computed for them.
 *
 * @param {object} element
 * @returns {{lat:number,lon:number}|null}
 */
export function elementPoint(element) {
  const lat = coordinate(element?.lat);
  const lon = coordinate(element?.lon);
  if (lat !== null && lon !== null) return { lat, lon };
  const centerLat = coordinate(element?.center?.lat);
  const centerLon = coordinate(element?.center?.lon);
  if (centerLat !== null && centerLon !== null) {
    return { lat: centerLat, lon: centerLon };
  }
  return null;
}

/**
 * Read the named entities out of an Overpass answer.
 *
 * @param {object} payload
 * @returns {Array<{id:number|string,type:string,name:string,kind:string,lat:number,lon:number}>}
 */
export function parseOverpassElements(payload) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const parsed = [];
  for (const element of elements) {
    const tags = element?.tags || {};
    const name = String(tags.name || '').trim();
    if (!name) continue;
    const kind = entityKind(tags);
    if (!kind) continue;
    const point = elementPoint(element);
    if (!point) continue;
    parsed.push({
      id: element?.id,
      type: String(element?.type || ''),
      name,
      kind,
      lat: point.lat,
      lon: point.lon,
    });
  }
  return parsed;
}

/**
 * The Overpass query for the named entities of a box.
 *
 * One statement, node only, no key pattern: a statement per tag and per
 * element type asks the instance for the same box dozens of times, and a
 * shared mirror answers that with a gateway timeout. Asking once for the
 * named nodes of the box is fast, and the kind of each entity is read from
 * its tags afterwards.
 *
 * @param {{south:number,west:number,north:number,east:number}} bbox
 * @returns {string}
 */
export function buildOverpassQuery(bbox) {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return [
    '[out:json][timeout:25];',
    `node["name"](${box});`,
    // A count limit keeps the answer bounded: the panel shows the nearest
    // actors, and a dense city block otherwise answers with every named
    // node in the box.
    'out center tags 2000;',
  ].join('\n');
}

/**
 * Ask Overpass for the named entities around a point.
 *
 * @param {{south:number,west:number,north:number,east:number}} bbox
 * @param {object} [options]
 */
export async function fetchNearbyEntities(bbox, options = {}) {
  const {
    fetchImpl = (...args) => fetch(...args),
    signal,
    timeoutMs = OVERPASS_TIMEOUT_MS,
    url = overpassUrl(),
  } = options;
  if (!url) {
    const error = new Error(OVERPASS_NOT_CONFIGURED);
    error.code = 'not_configured';
    throw error;
  }
  const request = timedFetch(fetchImpl, timeoutMs, signal);
  const query = buildOverpassQuery(bbox);
  const body = `data=${encodeURIComponent(query)}`;
  const send = () =>
    request(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': OVERPASS_USER_AGENT,
      },
      body,
    });
  let response = await send();
  // A shared instance answers a busy city with a gateway timeout now and then,
  // and the same query succeeds on the second try. One retry, not a loop.
  if (response.status >= 500 && response.status < 600) {
    response = await send();
  }
  if (!response.ok) {
    const error = new Error(`overpass answered HTTP ${response.status}`);
    error.code = 'upstream_error';
    throw error;
  }
  const payload = await response.json();
  if (String(payload?.remark || '').trim()) {
    const error = new Error(`overpass reported: ${payload.remark}`);
    error.code = 'upstream_error';
    throw error;
  }
  if (!Array.isArray(payload?.elements)) {
    const error = new Error('overpass answered an unreadable payload');
    error.code = 'upstream_error';
    throw error;
  }
  return parseOverpassElements(payload);
}

/**
 * A point written as a coordinate pair.
 *
 * "lat, lon" is an unambiguous position, while a name can be a district, a
 * village and a regency at once. The pair is read as latitude first,
 * longitude second.
 *
 * @param {unknown} value
 * @returns {{lat:number, lon:number}|null}
 */
export function parseCoordinate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parts = text.split(/[;,\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Count what was found, per source.
 *
 * @param {Array<object>} results
 */
export function countBySource(results) {
  const counts = new Map();
  for (const item of results) {
    const key = String(item?.source || 'unknown');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/**
 * The digital trace of a target: how much of it is online, and where.
 *
 * @param {{engine?:string,ok?:boolean,results?:Array<object>,note?:string}} search
 */
export function buildInvolvement(search) {
  const results = Array.isArray(search?.results) ? search.results : [];
  const bySource = countBySource(results);
  const top = results.slice(0, TOP_RESULT_LIMIT).map((item) => ({
    title: String(item?.title || ''),
    url: String(item?.url || ''),
    source: String(item?.source || ''),
    publishedAt: Number.isFinite(item?.publishedAt) ? item.publishedAt : null,
  }));
  const status = results.length ? 'ok' : search?.ok ? 'empty' : 'unavailable';
  return {
    status,
    engine: String(search?.engine || 'fallback'),
    total: results.length,
    bySource,
    top,
    summary: results.length
      ? `${results.length} results from ${bySource.length} sources`
      : 'no digital trace was found',
    note: String(search?.note || ''),
  };
}

/**
 * The entities closest to the target.
 *
 * @param {Array<object>} elements
 * @param {{lat:number,lon:number}} origin
 * @param {number} radiusKm
 * @param {number} limit
 */
export function rankNearby(elements, origin, radiusKm, limit = NEARBY_LIMIT) {
  return elements
    .map((element) => ({
      ...element,
      distanceKm: haversineKm(origin, element),
    }))
    .filter((element) => Number.isFinite(element.distanceKm))
    .filter((element) => element.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/**
 * How many of each kind were found.
 *
 * @param {Array<object>} items
 */
export function summarizeKinds(items) {
  const counts = new Map();
  for (const item of items) {
    const key = String(item?.kind || 'unknown');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * Build the profile of a target.
 *
 * @param {string} target
 * @param {object} [options]
 * @param {number} [options.radiusKm]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.limit]
 * @returns {Promise<object>}
 */
export async function buildTargetProfile(target, options = {}) {
  const {
    radiusKm = DEFAULT_RADIUS_KM,
    fetchImpl = (...args) => fetch(...args),
    signal,
    limit = NEARBY_LIMIT,
    now = Date.now,
    hint = '',
  } = options;
  const name = String(target || '').trim();
  if (!name) {
    const error = new Error('a target name is required');
    error.code = 'target_required';
    throw error;
  }
  const radius = clampRadiusKm(radiusKm);
  const sources = [];
  const region = String(hint || '').trim();

  // A coordinate is a position already: no geocoding, no ambiguity. Places
  // whose names repeat (a district, a village, a regency) are better asked
  // for by their point than by their name.
  const point = parseCoordinate(name);
  // The geocode and the search do not depend on each other, so they run
  // together: the search is the slow leg, not the geocode.
  const [place, search] = await Promise.allSettled([
    point
      ? Promise.resolve(null)
      : resolvePlace(region ? `${name}, ${region}` : name, {
          fetchImpl: timedFetch(fetchImpl, SOURCE_TIMEOUT_MS, signal),
        }),
    searchWeb(name, { fetchImpl, signal }),
  ]);

  let position;
  if (point) {
    position = {
      status: 'ok',
      name,
      lat: point.lat,
      lon: point.lon,
      bbox: bboxAround(point.lat, point.lon, radius),
      radiusKm: radius,
      source: 'coordinate',
    };
    sources.push({
      name: 'nominatim',
      ok: true,
      detail: `read the point ${position.lat}, ${position.lon} from the input`,
    });
  } else if (place.status === 'fulfilled') {
    position = {
      status: 'ok',
      name: place.value?.name || name,
      lat: place.value?.lat,
      lon: place.value?.lon,
      bbox: bboxAround(place.value?.lat, place.value?.lon, radius),
      radiusKm: radius,
      source: place.value?.source || 'nominatim',
    };
    sources.push({
      name: 'nominatim',
      ok: true,
      detail: `geocoded to ${position.lat}, ${position.lon}`,
    });
  } else {
    position = {
      status: 'unavailable',
      name,
      radiusKm: radius,
      detail: reason(place.reason),
    };
    sources.push({ name: 'nominatim', ok: false, detail: position.detail });
  }

  const involvement = buildInvolvement(
    search.status === 'fulfilled'
      ? search.value
      : {
          engine: 'fallback',
          ok: false,
          results: [],
          note: reason(search.reason),
        },
  );
  sources.push({
    name: 'search',
    ok: involvement.status !== 'unavailable',
    detail: involvement.note || involvement.summary,
  });

  let nearby;
  if (position.status !== 'ok') {
    nearby = {
      status: 'unavailable',
      radiusKm: radius,
      total: 0,
      items: [],
      kinds: [],
      detail: 'the target could not be geocoded',
    };
    sources.push({ name: 'overpass', ok: false, detail: nearby.detail });
  } else {
    try {
      const elements = await fetchNearbyEntities(position.bbox, {
        fetchImpl,
        signal,
      });
      const items = rankNearby(
        elements,
        { lat: position.lat, lon: position.lon },
        radius,
        limit,
      );
      nearby = {
        status: items.length ? 'ok' : 'empty',
        radiusKm: radius,
        total: elements.length,
        items,
        kinds: summarizeKinds(items),
        detail: `${elements.length} named entities in the area`,
      };
      sources.push({ name: 'overpass', ok: true, detail: nearby.detail });
    } catch (error) {
      nearby = {
        status: 'unavailable',
        radiusKm: radius,
        total: 0,
        items: [],
        kinds: [],
        detail: reason(error),
      };
      sources.push({ name: 'overpass', ok: false, detail: nearby.detail });
    }
  }

  return {
    target: name,
    hint: String(hint || '').trim(),
    radiusKm: radius,
    position,
    involvement,
    nearby,
    generatedAt: now(),
    sources,
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * The route handler for the target profile.
 *
 * GET /api/godseye/target?target=Madrid&radiusKm=25
 *
 * @param {object} req
 * @param {object} res
 * @param {object} [options] server-only seams for the tests
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function handleTarget(req, res, options = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const target = String(url.searchParams.get('target') || '').trim();
  if (!target) {
    return sendJson(res, 400, {
      ok: false,
      error: 'target_required',
      hint: 'Pass ?target=Madrid',
    });
  }
  const radiusKm = clampRadiusKm(url.searchParams.get('radiusKm'));
  // A region hint disambiguates a name that repeats in several countries.
  const hint = String(url.searchParams.get('hint') || '').trim();
  const key = `${target.toLowerCase()}|${radiusKm}|${hint.toLowerCase()}`;
  const now = Date.now();
  const cached = profileCache.get(key);
  if (cached && now - cached.at < PROFILE_CACHE_TTL_MS) {
    return sendJson(res, 200, { ok: true, cached: true, ...cached.payload });
  }
  try {
    const profile = await buildTargetProfile(target, {
      radiusKm,
      hint,
      now: () => now,
      ...options,
    });
    profileCache.set(key, { at: now, payload: profile });
    while (profileCache.size > PROFILE_CACHE_MAX_ENTRIES) {
      profileCache.delete(profileCache.keys().next().value);
    }
    return sendJson(res, 200, { ok: true, cached: false, ...profile });
  } catch (error) {
    return sendJson(res, 502, {
      ok: false,
      error: 'upstream_unreachable',
      detail: reason(error),
    });
  }
}
