import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CCTV_CATALOG,
  fetchCctvEnhanced,
  getCctvCount,
  haversineKm,
} from '../../services/place-card-local/cctv-enhanced.mjs';
import {
  buildTargetProfile,
  getTargetsByRegion,
  resolveTarget,
} from '../../services/place-card-local/target-tracker.mjs';
import {
  getCarrier,
  isInPapua,
  lookupCell,
} from '../../services/place-card-local/cell-tower.mjs';
import {
  compositeScore,
  detectAnomaly,
  exportCSV,
  exportGeoJSON,
  exportKML,
  generateHeatmap,
  trackMovement,
  WEIGHT_PROFILES,
} from '../../services/place-card-local/phaseC.mjs';
import { PAPUA_AREAS } from '../../services/place-card-local/vision-papua.mjs';
import {
  BTS_SEED,
  describePoint,
  findCells,
  trilaterate,
} from '../../services/place-card-local/bts-registry.mjs';
import {
  apiKeyFromEnv,
  cellPosition,
  OCID_ATTRIBUTION,
} from '../../services/place-card-local/opencellid.mjs';
import {
  findProvince,
  provinceCoverage,
  provinceOf,
  sitesInProvince,
} from '../../services/place-card-local/papua-provinces.mjs';
import { buildCapabilities } from '../../services/place-card-local/capabilities.mjs';
import {
  FREE_SOURCES,
  sourceSummary,
} from '../../services/place-card-local/free-sources.mjs';
import {
  fetchImageryTile,
  imageryCredit,
  verifyHeight,
} from '../../services/place-card-local/imagery.mjs';
import {
  elevationAt,
  prefetchArea,
} from '../../services/place-card-local/elevation.mjs';
import {
  TECH_PROFILES,
  viewshed,
} from '../../services/place-card-local/propagation.mjs';
import { readTerrainCoverage } from '../../services/place-card-local/coverage-terrain.mjs';
import {
  attributionFor,
  sourcesForScope,
} from '../../services/place-card-local/attributions.mjs';
import {
  LEGAL_BASES,
  PERSON_BASES,
  record as recordAudit,
  tail as auditTail,
  verifyChain,
} from '../../services/place-card-local/audit-log.mjs';
import { historyFor, listTracks, recordPosition } from './target-history.js';

/**
 * Local intelligence routes for the God's Eye panel.
 *
 * Everything here reads the local catalogs and the JSON artifacts under
 * `src/data/place-card-results/`. Nothing is forwarded to a provider: the one
 * call that could leave the machine — the OpenCellID lookup — runs only when
 * the caller asks for it AND a key is present in the environment, so a plain
 * request is answered entirely from local data.
 */

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const DATA_DIR = path.join(ROOT, 'src/data/place-card-results');

/** Cell identifiers arrive as `510-10-12345-67890` (mcc-mnc-lac-cellid). */
const CELL_PATTERN = /^(\d{3})\D(\d{1,3})\D(\d+)\D(\d+)$/;

/**
 * The areas whose entry counts as an anomaly.
 *
 * The Papua vision areas double as the watch list: they are the places this
 * console already frames, so a track that reaches one is worth saying out loud.
 * A 20 km radius matches the accuracy of a cell estimate, which is ±5 km.
 */
const SENSITIVE_AREAS = PAPUA_AREAS.map((area) => ({
  name: area.name,
  lat: area.lat,
  lon: area.lon,
  radius: 20,
  severity: 'HIGH',
}));

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendFile(res, status, body, contentType, filename, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end(body);
}

/**
 * The legal basis a person-directed query stands on.
 *
 * A missing basis is not a warning: the route refuses. A console that tracks
 * people without asking why is a liability, and the field is only meaningful
 * if it can stop an answer.
 */
function readLegalBasis(req, url) {
  const raw = String(
    url.searchParams.get('legalBasis') || req.headers?.['x-legal-basis'] || '',
  )
    .trim()
    .toLowerCase();
  if (!raw) return { basis: null, valid: false };
  if (!LEGAL_BASES.includes(raw))
    return { basis: raw, valid: false, unknown: true };
  return { basis: raw, valid: true };
}

function readOnly(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  return false;
}

/** A bounded number from a query string, or the fallback when it is unusable. */
function boundedNumber(value, fallback, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Parse `lat` and `lon`; null when either is missing or out of range. */
function readPoint(url) {
  const rawLat = url.searchParams.get('lat');
  const rawLon = url.searchParams.get('lon');
  if (rawLat === null || rawLon === null) return null;
  if (String(rawLat).trim() === '' || String(rawLon).trim() === '') return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Read one local artifact; a missing or broken file reads as null. */
async function readArtifact(name) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The network generation a cell speaks, and the band it is planned on.
 *
 * "4G" is the console's label; "LTE" is the radio's. Both are here so an
 * answer never has to translate. `freqMhz` is the *planning profile* of the
 * technology — the registry knows the generation, not the exact EARFCN, and
 * saying so is the difference between an answer and a guess.
 */
const RADIO_BY_TECH = Object.freeze({
  '2G': 'GSM',
  '3G': 'UMTS',
  '4G': 'LTE',
  '5G': 'NR',
});

function radioOf(tech) {
  const key = String(tech || '').toUpperCase();
  return RADIO_BY_TECH[key] || null;
}

function bandProfileMhz(tech) {
  const profile = TECH_PROFILES[String(tech || '').toUpperCase()];
  return profile ? profile.freqMhz : null;
}

/**
 * The nearest tower in the shape the panel shows.
 *
 * `coveragePct` is what makes "near or far" answerable: 40% of a 4G cell and
 * 40% of a 2G cell are different facts, and the number carries both.
 */
function btsSummary(described, registry) {
  const nearest = described?.nearest;
  if (!nearest) return null;
  const province = provinceOf(nearest.lat, nearest.lon);
  return {
    id: nearest.id,
    name: nearest.name,
    tech: nearest.tech,
    radio: radioOf(nearest.tech),
    freqMhz: bandProfileMhz(nearest.tech),
    distanceKm: nearest.distanceKm,
    coveragePct: nearest.coveragePct,
    rangeKm: nearest.rangeKm ?? null,
    class: described.class,
    inCoverage: described.inCoverage,
    province: province?.name || null,
    source: registry?.source || null,
    synthetic: Boolean(registry?.synthetic),
  };
}

/**
 * The watch-list hits for a whole track, nearest entry per area.
 *
 * Checking only the latest fix would forget that the target had already been
 * inside a watched area, which is the thing worth knowing about a track.
 */
function areaEntries(track, points) {
  const hits = new Map();
  for (const point of points) {
    for (const area of SENSITIVE_AREAS) {
      const distance = haversineKm(point.lat, point.lon, area.lat, area.lon);
      if (distance > area.radius) continue;
      const previous = hits.get(area.name);
      if (previous && previous.distance <= distance) continue;
      hits.set(area.name, {
        type: 'SENSITIVE_AREA_ENTRY',
        target: track,
        area: area.name,
        distance: Math.round(distance * 100) / 100,
        severity: area.severity,
      });
    }
  }
  return [...hits.values()];
}

/**
 * Distance, speed and anomalies for one track.
 *
 * The speed is the distance between two fixes over the time between them, so
 * it is only as good as the fixes: a cell estimate carries ±5 km, and two
 * fixes taken seconds apart cannot imply a speed at all. Below
 * MIN_SPEED_INTERVAL_SEC the speed is reported as unknown instead of as a
 * number nobody should act on.
 */
const MIN_SPEED_INTERVAL_SEC = 60;

function summariseTrack(track, points) {
  const list = Array.isArray(points) ? points : [];
  const latest = list[list.length - 1] || null;
  const movement = trackMovement(track, list);
  const lastSegment = movement.segments[movement.segments.length - 1] || null;
  const intervalSec = lastSegment?.durationSec ?? null;
  const speedReliable =
    Number.isFinite(intervalSec) && intervalSec >= MIN_SPEED_INTERVAL_SEC;
  const reported = latest
    ? detectAnomaly(
        {
          id: track,
          lat: latest.lat,
          lon: latest.lon,
          timestamp: latest.timestamp,
        },
        list.slice(0, -1),
        [],
      ).anomalies || []
    : [];
  // A speed flag derived from two fixes a second apart is noise, not a finding.
  const speedFlags = speedReliable
    ? reported.filter((entry) => entry.type === 'SPEED_ANOMALY')
    : [];
  const anomalies = [...areaEntries(track, list), ...speedFlags];
  return {
    track,
    points: list.length,
    distanceKm: movement.totalDistanceKm,
    avgSpeedKmh: speedReliable ? movement.avgSpeedKmh : null,
    maxSpeedKmh: speedReliable ? movement.maxSpeedKmh : null,
    intervalSec,
    speedReliable,
    bearing: lastSegment?.bearing ?? null,
    hasAnomaly: anomalies.length > 0,
    anomalies,
  };
}

/** The points every export starts from: catalog targets, cameras, vision areas. */
function localPoints({ scope = 'all' } = {}) {
  const points = [];
  if (scope === 'all' || scope === 'cctv') {
    for (const camera of CCTV_CATALOG) {
      points.push({
        id: camera.id,
        name: camera.name,
        lat: camera.lat,
        lon: camera.lon,
        kind: 'cctv',
        type: camera.type,
        city: camera.city,
        provider: camera.provider,
      });
    }
  }
  if (scope === 'all' || scope === 'vision') {
    for (const area of PAPUA_AREAS) {
      points.push({
        id: area.id,
        name: area.name,
        lat: area.lat,
        lon: area.lon,
        kind: 'vision-area',
        terrain: area.terrain,
      });
    }
  }
  return points;
}

/**
 * GET /api/godseye/cctv
 *
 * `?catalog=1` answers with the whole catalog's counts. Otherwise `lat`/`lon`
 * are required and the answer lists the cameras inside `radiusKm`.
 */
async function handleCctv(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('catalog') === '1') {
    return sendJson(res, 200, {
      ok: true,
      counts: getCctvCount(),
      cities: [...new Set(CCTV_CATALOG.map((camera) => camera.city))].sort(),
    });
  }
  const origin = readPoint(url);
  if (!origin) {
    return sendJson(res, 400, {
      ok: false,
      error: 'point_required',
      hint: 'Pass ?lat=-4.53&lon=140.5 or ?catalog=1',
    });
  }
  const radiusKm = boundedNumber(url.searchParams.get('radiusKm'), 50, 1, 500);
  const type = url.searchParams.get('type') || null;
  const city = url.searchParams.get('city') || null;
  const provider = url.searchParams.get('provider') || null;
  const result = await fetchCctvEnhanced(origin.lat, origin.lon, radiusKm, {
    type,
    city,
    provider,
  });
  return sendJson(res, 200, {
    ok: true,
    origin,
    radiusKm,
    filters: { type, city, provider },
    source: 'local-catalog',
    ...result,
  });
}

/**
 * GET /api/godseye/locate
 *
 * `?q=` is a target name, a phone number, or a cell identifier. A cell
 * identifier is answered from the local estimate unless `live=1` is passed and
 * `OPENCELLID_API_KEY` is set, which is the only path that leaves the machine.
 */
async function handleLocate(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const query = String(url.searchParams.get('q') || '').trim();
  const region = String(url.searchParams.get('region') || '').trim();

  if (!query && region) {
    const listed = await getTargetsByRegion(region);
    return sendJson(res, 200, { ok: true, mode: 'region', region, ...listed });
  }
  if (!query) {
    return sendJson(res, 400, {
      ok: false,
      error: 'query_required',
      hint: 'Pass ?q=Target Papua 1, ?q=+6281234567890 or ?q=510-10-12345-67890',
    });
  }

  const cell = query.match(CELL_PATTERN);
  if (cell) {
    const mcc = Number(cell[1]);
    const mnc = Number(cell[2]);
    const lac = Number(cell[3]);
    const cellId = Number(cell[4]);
    const live = url.searchParams.get('live') === '1';
    const key = live ? apiKeyFromEnv() : '';
    const registry = await loadBtsRegistry();

    // Order of evidence, best first:
    //   1. the imported registry knows this exact cell → the tower's position
    //   2. the provider knows it (opt-in, keyed)          → a measured fix
    //   3. nothing knows it                               → a regional estimate
    // Answering 3 while 1 was available is what made every lookup look fake.
    const known = findCells(registry.sites, [{ mcc, mnc, lac, cellId }]);
    let found = null;
    let source = null;
    let positionBasis = null;
    let liveError = null;

    if (known.length) {
      const match = known[0];
      found = {
        lat: match.site.lat,
        lon: match.site.lon,
        accuracy: Math.round((Number(match.site.rangeKm) || 5) * 1000),
        carrier: getCarrier(mcc, mnc),
        region: provinceOf(match.site.lat, match.site.lon)?.name || null,
        estimated: false,
        site: {
          id: match.site.id,
          name: match.site.name,
          tech: match.site.tech,
          radio: radioOf(match.site.tech),
          freqMhz: bandProfileMhz(match.site.tech),
          freqBasis: 'planning-profile',
        },
      };
      source = 'bts-registry';
      positionBasis = 'known-tower';
    } else if (key) {
      const answer = await cellPosition({ key, mcc, mnc, lac, cellId });
      if (answer.ok) {
        found = {
          lat: answer.cell.lat,
          lon: answer.cell.lon,
          accuracy: answer.cell.rangeM || 1000,
          carrier: getCarrier(mcc, mnc),
          region: provinceOf(answer.cell.lat, answer.cell.lon)?.name || null,
          estimated: false,
          // The provider states the cell's radio generation; the MHz beside it
          // is the technology's planning frequency, labelled as such — the
          // exact channel is not published per cell.
          site: answer.cell.tech
            ? {
                id: null,
                name: null,
                tech: answer.cell.tech,
                radio: answer.cell.radio,
                freqMhz: bandProfileMhz(answer.cell.tech),
                freqBasis: 'planning-profile',
              }
            : null,
          samples: answer.cell.samples,
        };
        source = 'opencellid';
        positionBasis = 'provider-fix';
      } else {
        // The provider was asked and refused: say why, so an operator with a
        // bad key does not read the estimate below as a provider answer.
        liveError = answer.error || 'lookup_failed';
      }
    }

    if (!found) {
      const estimated = await lookupCell(mcc, mnc, lac, cellId, '');
      found = estimated;
      source = 'local-estimate';
      positionBasis = 'carrier-region-estimate';
    }

    // Each lookup is one fix, and the fixes for one carrier form a track: that
    // is the whole of the time-series view, built without asking anyone where
    // the target is.
    const track = `cell:${mcc}-${mnc}`;
    const points = await recordPosition(track, {
      lat: found.lat,
      lon: found.lon,
      timestamp: Date.now(),
    });
    const province = provinceOf(found.lat, found.lon);
    const legalCell = readLegalBasis(req, url);
    const auditEntry = await recordAudit({
      action: 'locate',
      query,
      mode: 'cell',
      source,
      legalBasis: legalCell.basis,
      lat: found.lat,
      lon: found.lon,
      result: found.estimated ? 'estimated' : 'measured',
    });
    return sendJson(res, 200, {
      ok: true,
      mode: 'cell',
      audit: { seq: auditEntry.seq, hash: auditEntry.hash },
      query,
      live: Boolean(key),
      liveError,
      position: { lat: found.lat, lon: found.lon },
      accuracyM: found.accuracy,
      estimated: Boolean(found.estimated),
      positionBasis,
      inPapua:
        typeof found.isPapua === 'boolean'
          ? found.isPapua
          : isInPapua(found.lat, found.lon),
      province: province ? { id: province.id, name: province.name } : null,
      carrier: found.carrier || getCarrier(mcc, mnc),
      cell: { mcc, mnc, lac, cellId },
      estimateRegion: found.region || null,
      site: found.site || null,
      source,
      registry: { source: registry.source, synthetic: registry.synthetic },
      track: summariseTrack(track, points),
      bts: btsSummary(
        describePoint(registry.sites, found.lat, found.lon, { limit: 1 }),
        registry,
      ),
    });
  }

  // A person-directed query has to say why it is allowed. This is checked
  // before anything is resolved, so a refusal leaves no trace of a lookup.
  const legal = readLegalBasis(req, url);
  if (!legal.valid) {
    return sendJson(res, 428, {
      ok: false,
      error: legal.unknown ? 'legal_basis_unknown' : 'legal_basis_required',
      detail: legal.unknown
        ? `"${legal.basis}" is not a recognised legal basis`
        : 'A target query must state the legal basis it stands on',
      accepted: PERSON_BASES,
      hint: 'Pass ?legalBasis=consent (or the X-Legal-Basis header)',
    });
  }

  const profile = await buildTargetProfile(query);
  // `buildTargetProfile` answers with the profile itself when it resolved, so
  // the presence of a target is the success signal.
  if (!profile?.target) {
    const direct = await resolveTarget(query);
    await recordAudit({
      action: 'locate',
      query,
      mode: 'target',
      source: 'local-catalog',
      legalBasis: legal.basis,
      result: 'not_found',
    });
    return sendJson(res, 404, {
      ok: false,
      error: 'not_found',
      detail: direct?.reason || `No local match for "${query}"`,
    });
  }
  const registry = await loadBtsRegistry();
  const auditEntry = await recordAudit({
    action: 'locate',
    query,
    mode: 'target',
    source: profile.source || 'local-catalog',
    legalBasis: legal.basis,
    lat: profile.target?.lat,
    lon: profile.target?.lon,
    result: profile.synthetic ? 'catalog' : 'found',
  });
  return sendJson(res, 200, {
    ok: true,
    mode: 'target',
    audit: { seq: auditEntry.seq, hash: auditEntry.hash },
    legalBasis: legal.basis,
    ...profile,
    bts: btsSummary(
      describePoint(registry.sites, profile.target.lat, profile.target.lon, {
        limit: 1,
      }),
      registry,
    ),
  });
}

/**
 * GET /api/godseye/score
 *
 * Scores the four lanes with the adaptive weights. `source=dashboard` derives
 * the lane intensities from the local dashboard artifact instead of the query.
 */
async function handleScore(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const profile = String(url.searchParams.get('profile') || 'default');
  if (!WEIGHT_PROFILES[profile]) {
    return sendJson(res, 400, {
      ok: false,
      error: 'unknown_profile',
      profiles: Object.keys(WEIGHT_PROFILES),
    });
  }
  let input = {
    market: boundedNumber(url.searchParams.get('market'), 0, 0, 1),
    news: boundedNumber(url.searchParams.get('news'), 0, 0, 1),
    osint: boundedNumber(url.searchParams.get('osint'), 0, 0, 1),
    vision: boundedNumber(url.searchParams.get('vision'), 0, 0, 1),
  };
  let basis = 'query';
  if (url.searchParams.get('source') === 'dashboard') {
    const dashboard = await readArtifact('dashboard-indonesia.json');
    const summary = dashboard?.summary || {};
    const newsTotal = Number(summary.newsItems) || 0;
    const papuaNews = Number(summary.papuaNewsItems) || 0;
    input = {
      market: 0.5,
      news: newsTotal ? Math.min(papuaNews / newsTotal, 1) : 0,
      osint: Number(summary.targets)
        ? Math.min(Number(summary.targets) / 20, 1)
        : 0,
      vision: Number(summary.visionAreas)
        ? Math.min(Number(summary.visionAreas) / 12, 1)
        : 0,
    };
    basis = 'dashboard-indonesia.json';
  }
  return sendJson(res, 200, {
    ok: true,
    basis,
    input,
    ...compositeScore(input, profile),
  });
}

/**
 * GET /api/godseye/export?format=geojson|kml|csv&scope=all|targets|cctv|vision
 *
 * Serialises the local points so they can be opened in another tool. The
 * response is a download; nothing is written to disk.
 */
async function handleExport(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const format = String(
    url.searchParams.get('format') || 'geojson',
  ).toLowerCase();
  const scope = String(url.searchParams.get('scope') || 'all').toLowerCase();
  const points = localPoints({ scope });
  // The registry is the layer an operator most wants to hand to another tool,
  // so it exports through the same three formats as the rest of the console.
  if (scope === 'bts' || scope === 'all') {
    const registry = await loadBtsRegistry();
    for (const site of registry.sites) {
      points.push({
        id: site.id,
        name: site.name,
        lat: site.lat,
        lon: site.lon,
        kind: 'bts',
        type: site.tech,
        city: provinceOf(site.lat, site.lon)?.name || null,
        provider: site.source || registry.source,
      });
    }
  }
  const data = { points, heatmap: generateHeatmap(points, { gridDegrees: 1 }) };
  const stamp = new Date().toISOString().slice(0, 10);
  // Credit travels with the data: in the body where a consumer cannot strip
  // it, and in headers for clients that only read those.
  const attribution = attributionFor(sourcesForScope(scope));
  const creditHeaders = {
    'X-Attribution': attribution.summary,
    'X-License': attribution.licenses.join(', '),
  };

  if (format === 'geojson') {
    const payload = exportGeoJSON(data, { name: 'Gods Eye local points' });
    payload.metadata = {
      ...(payload.metadata || {}),
      attribution: attribution.texts,
      license: attribution.licenses,
    };
    const body = JSON.stringify(payload, null, 2);
    await recordAudit({
      action: 'export',
      mode: 'export',
      source: `export:${scope}:${format}`,
      result: `${points.length} points`,
    });
    return sendFile(
      res,
      200,
      body,
      'application/geo+json; charset=utf-8',
      `godseye-${scope}-${stamp}.geojson`,
      creditHeaders,
    );
  }
  if (format === 'kml') {
    const escape = (text) =>
      String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const raw = exportKML(data, { name: 'Gods Eye local points' });
    const body = raw.replace(
      '<Document>',
      `<Document>\n    <description>${escape(attribution.texts.join(' '))}</description>`,
    );
    await recordAudit({
      action: 'export',
      mode: 'export',
      source: `export:${scope}:${format}`,
      result: `${points.length} points`,
    });
    return sendFile(
      res,
      200,
      body,
      'application/vnd.google-earth.kml+xml; charset=utf-8',
      `godseye-${scope}-${stamp}.kml`,
      creditHeaders,
    );
  }
  if (format === 'csv') {
    const rows = exportCSV(data, {
      columns: ['id', 'name', 'kind', 'lat', 'lon', 'city', 'type', 'provider'],
    });
    // A comment line at the end keeps the header where every CSV reader
    // expects it while still carrying the credit inside the file.
    const body = `${rows.trimEnd()}\n# attribution: ${attribution.texts.join(' ')}\n`;
    await recordAudit({
      action: 'export',
      mode: 'export',
      source: `export:${scope}:${format}`,
      result: `${points.length} points`,
    });
    return sendFile(
      res,
      200,
      body,
      'text/csv; charset=utf-8',
      `godseye-${scope}-${stamp}.csv`,
      creditHeaders,
    );
  }
  return sendJson(res, 400, {
    ok: false,
    error: 'unknown_format',
    formats: ['geojson', 'kml', 'csv'],
  });
}

/**
 * GET /api/godseye/anomaly?track=cell:510-10 — the stored track, read only.
 *
 * `?list=1` answers with the tracks that exist instead, so the panel can show
 * what it has seen without guessing a key.
 */
async function handleAnomaly(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('list') === '1') {
    return sendJson(res, 200, { ok: true, tracks: await listTracks() });
  }
  const track = String(url.searchParams.get('track') || '').trim();
  if (!track) {
    return sendJson(res, 400, {
      ok: false,
      error: 'track_required',
      hint: 'Pass ?track=cell:510-10 or ?list=1',
    });
  }
  const points = await historyFor(track);
  if (!points.length) {
    return sendJson(res, 404, { ok: false, error: 'track_not_found', track });
  }
  return sendJson(res, 200, { ok: true, ...summariseTrack(track, points) });
}

/**
 * GET /api/godseye/news?region=papua|indonesia&limit=20
 *
 * The local news artifact, filtered. It is collected by a separate run and
 * only read here, so the panel shows what was actually gathered rather than
 * asking a feed on every render.
 */
async function handleNews(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const region = String(
    url.searchParams.get('region') || 'papua',
  ).toLowerCase();
  const limit = boundedNumber(url.searchParams.get('limit'), 20, 1, 60);
  const data = await readArtifact('indonesia-news.json');
  if (!data) {
    return sendJson(res, 404, {
      ok: false,
      error: 'news_unavailable',
      hint: 'Build indonesia-news.json with the news collector first',
    });
  }
  const all = Array.isArray(data.items) ? data.items : [];
  const items =
    region === 'indonesia'
      ? all
      : all.filter((item) => /papua/i.test(String(item?.query || '')));
  return sendJson(res, 200, {
    ok: true,
    region,
    generatedAt: data.generatedAt || null,
    total: items.length,
    items: items.slice(0, limit).map((item) => ({
      title: item.title,
      link: item.link,
      source: item.source || null,
      publishedAt: item.publishedAt || null,
      query: item.query || null,
    })),
  });
}

/**
 * The BTS registry: an imported artifact when one exists, the seed otherwise.
 *
 * The seed is synthetic, so every site carries `synthetic: true` all the way
 * to the panel; an imported registry replaces it by existing. Tests and
 * one-off runs point `GODSEYE_BTS_REGISTRY` at a file instead.
 */
async function loadBtsRegistry() {
  const override = process.env.GODSEYE_BTS_REGISTRY;
  let imported = null;
  if (override) {
    try {
      imported = JSON.parse(await readFile(override, 'utf8'));
    } catch {
      imported = null;
    }
  } else {
    imported = await readArtifact('bts-registry.json');
  }
  const sites = Array.isArray(imported?.sites) ? imported.sites : null;
  if (sites && sites.length) {
    return {
      sites,
      source: imported.source || 'imported',
      synthetic: Boolean(imported.synthetic),
      generatedAt: imported.generatedAt || null,
      attribution: imported.attribution || OCID_ATTRIBUTION,
      credits: imported.credits || null,
    };
  }
  return {
    sites: BTS_SEED,
    source: 'local-seed',
    synthetic: true,
    generatedAt: null,
    attribution: null,
    credits: null,
  };
}

/**
 * Terrain viewsheds, cached per site.
 *
 * A ring is 24 radials × up to 200 samples; with the DEM tiles already on disk
 * that is 40–400 ms. The registry changes once a day, so a 30-minute cache is
 * generous and keeps the panel responsive.
 *
 * `clutterModel` and `tiltDeg` are part of the cache key: the same site under
 * the roughness model and under a 6° downtilt are two different polygons, and
 * serving one for the other would be a silent lie.
 */
const viewshedCache = new Map();
const VIEWSHED_TTL_MS = 30 * 60 * 1000;

async function viewshedFor(
  site,
  tech,
  { clutterModel = 'flat', tiltDeg = 0 } = {},
) {
  const key = `${site.id || `${site.lat},${site.lon}`}:${tech}:${clutterModel}:${tiltDeg}`;
  const hit = viewshedCache.get(key);
  if (hit && Date.now() - hit.at < VIEWSHED_TTL_MS)
    return { ...hit.value, cached: true };
  const profile =
    TECH_PROFILES[String(tech || '').toUpperCase()] || TECH_PROFILES.unknown;
  // Pull the terrain block before walking the radials: without this the first
  // viewshed pays the network inside its innermost loop.
  const tiles = await prefetchArea(site.lat, site.lon, profile.capKm);
  const value = await viewshed({
    site: {
      id: site.id,
      lat: site.lat,
      lon: site.lon,
      heightM: site.heightM ?? 30,
    },
    profile,
    elevationAt,
    clutterModel,
    tiltDeg,
  });
  value.tilesPrefetched = tiles;
  if (viewshedCache.size > 64) {
    viewshedCache.delete(viewshedCache.keys().next().value);
  }
  viewshedCache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

/**
 * The coverage report, cached for a minute.
 *
 * Rasterising six provinces over a ~2 km grid costs ~120 ms; the panel asks on
 * every tab click and the registry changes once a day at most.
 */
let coverageCache = null;

function coverageFor(registry) {
  const key = `${registry.sites.length}:${registry.source}:${registry.generatedAt}`;
  if (
    coverageCache &&
    coverageCache.key === key &&
    Date.now() - coverageCache.at < 60_000
  ) {
    return coverageCache.report;
  }
  const report = provinceCoverage(registry.sites);
  coverageCache = { key, at: Date.now(), report };
  return report;
}

/**
 * GET /api/godseye/bts
 *
 * `?lat=&lon=` answers how near the point is to the closest sites.
 * `?cells=510-11-123-456,...` answers which sites carry those cells and, with
 * two or more, where they place the target.
 * `?coverage=1` answers how much of each Papua province the registry covers.
 * `?province=papua-tengah` narrows a listing to one province.
 * `?catalog=1` answers what the registry holds.
 */
async function handleBts(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const registry = await loadBtsRegistry();
  const meta = {
    source: registry.source,
    synthetic: registry.synthetic,
    generatedAt: registry.generatedAt,
    attribution: registry.attribution,
    credits: registry.credits,
  };

  if (url.searchParams.get('coverage') === '1') {
    const province = findProvince(url.searchParams.get('province'));
    const report = coverageFor(registry);
    const provinces = province
      ? report.provinces.filter((row) => row.id === province.id)
      : report.provinces;
    const payload = {
      ok: true,
      ...meta,
      sites: registry.sites.length,
      province: province?.id || null,
      provinces,
      totals: report.totals,
    };
    // `&terrain=1` answers the harder question: the same grid, painted from
    // the polygons the ground allows instead of planning circles. The batch
    // job that computes it lives in coverage-terrain.mjs; until it has run
    // the route says "not computed" rather than repeating the flat number.
    if (url.searchParams.get('terrain') === '1') {
      const artifact = await readTerrainCoverage();
      payload.terrain = artifact
        ? {
            computedAt: artifact.computedAt,
            model: artifact.model,
            sites: artifact.sites,
            flatEarthSites: artifact.report.flatEarthSites,
            provinces: artifact.report.provinces.map((row) => ({
              id: row.id,
              name: row.name,
              coveredPct: row.coveredPct,
              coveredPoints: row.coveredPoints,
              samplePoints: row.samplePoints,
              basis: row.basis,
              // The flat-earth control: same sites, same caps, no terrain.
              // The difference between the two is what the mountains take.
              controlPct: row.controlPct,
              terrainDeltaPct: row.terrainDeltaPct,
              controlBasis: row.controlBasis,
            })),
            totals: artifact.report.totals,
            registrySites: registry.sites.length,
            // A run that died before publishing leaves the previous artifact
            // in place; the registry has since grown. The numbers are still
            // true of the sites they were computed from — but they are not
            // the current registry, and the panel must say so.
            stale: artifact.sites !== registry.sites.length,
          }
        : null;
      if (!payload.terrain) {
        payload.hint =
          'Terrain-aware coverage has not been computed yet: run npm run bts:coverage';
      }
    }
    return sendJson(res, 200, payload);
  }

  if (url.searchParams.get('catalog') === '1') {
    // `?sites=1` adds the registry itself, for the globe layer that draws it.
    // The panel reads the same route, so the globe and the panel can never
    // disagree about how many towers exist.
    if (url.searchParams.get('sites') === '1') {
      return sendJson(res, 200, {
        ok: true,
        ...meta,
        sites: registry.sites.map((site) => ({
          id: site.id,
          name: site.name,
          lat: site.lat,
          lon: site.lon,
          tech: site.tech,
          rangeKm: site.rangeKm,
          cells: Array.isArray(site.cells) ? site.cells : [],
          samples: site.samples,
        })),
      });
    }
    const byTech = {};
    const byRadio = {};
    const byProvince = {};
    for (const site of registry.sites) {
      const techKey = site.tech || 'unknown';
      byTech[techKey] = (byTech[techKey] || 0) + 1;
      // The radio generation a handset on this site is served by — the one
      // frequency-ish fact the registry actually knows, as opposed to the
      // planning MHz in TECH_PROFILES.
      const radioKey = radioOf(techKey);
      byRadio[radioKey] = (byRadio[radioKey] || 0) + 1;
      const province = provinceOf(site.lat, site.lon);
      const provinceKey = province?.id || 'outside-papua';
      byProvince[provinceKey] = (byProvince[provinceKey] || 0) + 1;
    }
    return sendJson(res, 200, {
      ok: true,
      ...meta,
      sites: registry.sites.length,
      cells: registry.sites.reduce(
        (sum, site) =>
          sum + (Array.isArray(site.cells) ? site.cells.length : 0),
        0,
      ),
      byTech,
      byRadio,
      byProvince,
    });
  }

  if (url.searchParams.get('viewshed') === '1') {
    const siteId = String(url.searchParams.get('site') || '').trim();
    const tech = String(url.searchParams.get('tech') || '').toUpperCase();
    let site = siteId
      ? registry.sites.find((entry) => entry.id === siteId)
      : null;
    if (!site) {
      const point = readPoint(url);
      if (point) {
        site = {
          id: 'adhoc',
          lat: point.lat,
          lon: point.lon,
          tech: tech || '4G',
          heightM: boundedNumber(url.searchParams.get('heightM'), 30, 5, 120),
        };
      }
    }
    if (!site) {
      return sendJson(res, 400, {
        ok: false,
        error: 'site_required',
        hint: 'Pass ?site=<id>&viewshed=1, or ?lat&lon&tech=4G&viewshed=1',
      });
    }
    const result = await viewshedFor(site, tech || site.tech);
    return sendJson(res, 200, {
      ok: true,
      ...meta,
      ...result,
      terrainKnown: result.site.groundM !== 0 || result.stats.maxKm > 0,
    });
  }

  const cellsParam = String(url.searchParams.get('cells') || '').trim();
  if (cellsParam) {
    const cells = cellsParam
      .split(',')
      .map((entry) => {
        const parts = entry.trim().split(/[-_:]/);
        if (parts.length < 4) return null;
        return {
          mcc: Number(parts[0]),
          mnc: Number(parts[1]),
          lac: Number(parts[2]),
          cellId: Number(parts[3]),
        };
      })
      .filter(Boolean);
    const matches = findCells(registry.sites, cells);
    const observations = matches.map((match) => ({
      lat: match.site.lat,
      lon: match.site.lon,
      // A tight cell constrains the position harder than a 35 km rural one, so
      // the weight is the inverse of the radius: 5 km counts 7× a 35 km cell.
      weight:
        1 /
        (Number.isFinite(Number(match.site.rangeKm)) && match.site.rangeKm > 0
          ? Number(match.site.rangeKm)
          : 5),
    }));
    const position = trilaterate(observations);
    return sendJson(res, 200, {
      ok: true,
      ...meta,
      cells: cells.length,
      matched: matches.map((match) => ({
        cell: match.cell,
        site: {
          id: match.site.id,
          name: match.site.name,
          tech: match.site.tech,
        },
      })),
      position: position.ok
        ? {
            ...position,
            province: provinceOf(position.lat, position.lon)?.name || null,
          }
        : position,
      hint: matches.length
        ? undefined
        : 'No site in the registry serves these cells; import a registry with cell ids',
    });
  }

  const provinceFilter = findProvince(url.searchParams.get('province'));
  const origin = readPoint(url);
  if (!origin) {
    if (provinceFilter) {
      const sites = sitesInProvince(registry.sites, provinceFilter.id).slice(
        0,
        200,
      );
      return sendJson(res, 200, {
        ok: true,
        ...meta,
        province: { id: provinceFilter.id, name: provinceFilter.name },
        sites: sites.length,
        items: sites.map((site) => ({
          id: site.id,
          name: site.name,
          lat: site.lat,
          lon: site.lon,
          tech: site.tech,
          rangeKm: site.rangeKm ?? null,
        })),
      });
    }
    return sendJson(res, 400, {
      ok: false,
      error: 'point_required',
      hint: 'Pass ?lat=-4.53&lon=140.5, ?cells=..., ?coverage=1 or ?catalog=1',
    });
  }
  const limit = boundedNumber(url.searchParams.get('limit'), 5, 1, 20);
  const radiusKm = url.searchParams.has('radiusKm')
    ? boundedNumber(url.searchParams.get('radiusKm'), 50, 1, 500)
    : null;
  const described = describePoint(registry.sites, origin.lat, origin.lon, {
    limit,
  });
  return sendJson(res, 200, {
    ok: true,
    ...meta,
    origin,
    province: provinceOf(origin.lat, origin.lon)?.name || null,
    ...described,
  });
}

/**
 * Whether the terrain model can actually answer.
 *
 * One lookup of a known coastal point decides it; the tile is cached, so this
 * costs ~1 ms after the first call and nothing when the DEM is switched off.
 */
let terrainProbe = null;
let terrainProbeAt = 0;

async function terrainKnown() {
  if (terrainProbe !== null && Date.now() - terrainProbeAt < 60_000) {
    return terrainProbe;
  }
  let known = false;
  try {
    known = Number.isFinite(await elevationAt(-2.5337, 140.7175));
  } catch {
    known = false;
  }
  terrainProbe = known;
  terrainProbeAt = Date.now();
  return known;
}

/**
 * GET /api/godseye/capabilities
 *
 * What is measured, what is estimated, what is only a sample, and what is
 * waiting on a key — with the live counts behind each answer. A console that
 * cannot say this about itself is asking to be misread.
 */
async function handleCapabilities(req, res) {
  if (!readOnly(req, res)) return;
  const registry = await loadBtsRegistry();
  const counts = getCctvCount();
  const targets = await getTargetsByRegion('indonesia');
  const newsArtifact = await readArtifact('indonesia-news.json');
  const items = Array.isArray(newsArtifact?.items) ? newsArtifact.items : [];
  const news = items.length
    ? {
        total: items.length,
        papua: items.filter((item) => /papua/i.test(String(item?.query || '')))
          .length,
      }
    : null;

  return sendJson(res, 200, {
    ok: true,
    ...buildCapabilities({
      bts: {
        sites: registry.sites.length,
        cells: registry.sites.reduce(
          (sum, site) =>
            sum + (Array.isArray(site.cells) ? site.cells.length : 0),
          0,
        ),
        source: registry.source,
        synthetic: registry.synthetic,
      },
      cctv: { total: counts.total, papua: counts.papua, byType: counts.byType },
      targets: { count: targets.count },
      news,
      vision: { areas: PAPUA_AREAS.length },
      terrain: { known: await terrainKnown() },
      env: {
        visionModel: process.env.GEV_VISION_MODEL || null,
        opencellid: Boolean(apiKeyFromEnv()),
      },
    }),
    // What the console leans on for free, and what it is still missing: the
    // list an operator reads before asking for a budget.
    freeSources: sourceSummary(),
  });
}

/**
 * GET /api/godseye/imagery — the real photograph of a point.
 *
 * A coordinate on its own asks the operator to trust a number. This returns
 * the satellite tile that contains it, so the panel can put a picture next to
 * the answer: "here is what is actually at this coordinate". Proxied here
 * because the browser may not fetch Esri directly, and cached on disk because
 * re-searching a place should not pay for the same photograph twice.
 *
 * `?meta=1` answers the tile's description without the bytes.
 */
async function handleImagery(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const origin = readPoint(url);
  if (!origin) {
    return sendJson(res, 400, {
      ok: false,
      error: 'point_required',
      hint: 'Pass ?lat=&lon= (and optionally ?zoom=, 0–19)',
    });
  }
  const zoom = boundedNumber(url.searchParams.get('zoom'), 15, 0, 19);
  const tile = await fetchImageryTile(origin.lat, origin.lon, zoom);
  if (!tile) {
    return sendJson(res, 502, {
      ok: false,
      error: 'imagery_unavailable',
      detail: 'The imagery provider did not answer for this point.',
    });
  }
  if (url.searchParams.get('meta') === '1') {
    return sendJson(res, 200, {
      ok: true,
      origin,
      zoom: tile.zoom,
      x: tile.x,
      y: tile.y,
      groundM: tile.groundM,
      width: tile.width,
      height: tile.height,
      bytes: tile.bytes.length,
      credit: imageryCredit(),
    });
  }
  // Credit in a header the browser can show and a log line can carry.
  res.statusCode = 200;
  res.setHeader('Content-Type', tile.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Imagery-Source', tile.source);
  res.setHeader('X-Attribution', imageryCredit().text);
  res.setHeader('Content-Length', tile.bytes.length);
  res.end(tile.bytes);
}

/**
 * GET /api/godseye/verify — is this height real?
 *
 * Two independent elevation models (the local Terrarium DEM and Open-Meteo's
 * Copernicus DEM) are asked the same question. Agreement is the evidence; a
 * disagreement is reported instead of averaged away. A console that cannot
 * check its own terrain is guessing with extra steps.
 */
async function handleVerify(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const origin = readPoint(url);
  if (!origin) {
    return sendJson(res, 400, {
      ok: false,
      error: 'point_required',
      hint: 'Pass ?lat=&lon=',
    });
  }
  const height = await verifyHeight(origin.lat, origin.lon);
  const tile = await fetchImageryTile(origin.lat, origin.lon, 15);
  return sendJson(res, 200, {
    ok: true,
    origin,
    height,
    imagery: tile
      ? {
          available: true,
          groundM: tile.groundM,
          zoom: tile.zoom,
          source: tile.source,
          url: `/api/godseye/imagery?lat=${origin.lat}&lon=${origin.lon}&zoom=15`,
        }
      : { available: false },
    sources: FREE_SOURCES.map((source) => ({
      id: source.id,
      kind: source.kind,
      status: source.status,
      key: source.key,
    })),
  });
}

/**
 * GET /api/godseye/audit — what was asked, and proof it was not edited.
 *
 * `?verify=1` recomputes the hash chain; the default lists the newest entries.
 * The query itself is never stored, only its HMAC — enough to prove which
 * question was asked, without keeping the phone number that was typed.
 */
async function handleAudit(req, res) {
  if (!readOnly(req, res)) return;
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('verify') === '1') {
    const chain = verifyChain();
    return sendJson(res, chain.ok ? 200 : 409, { ok: chain.ok, ...chain });
  }
  const limit = boundedNumber(url.searchParams.get('limit'), 50, 1, 500);
  const entries = auditTail(limit);
  return sendJson(res, 200, {
    ok: true,
    count: entries.length,
    entries,
    note: 'Queries are stored as an HMAC, never as text.',
  });
}

/** GET /api/godseye/intel — the local summary the panel shows in its status line. */
async function handleIntel(req, res) {
  if (!readOnly(req, res)) return;
  const dashboard = await readArtifact('dashboard-indonesia.json');
  const targets = await getTargetsByRegion('indonesia');
  const registry = await loadBtsRegistry();
  const byProvince = {};
  for (const site of registry.sites) {
    const province = provinceOf(site.lat, site.lon);
    const key = province?.id || 'outside-papua';
    byProvince[key] = (byProvince[key] || 0) + 1;
  }
  return sendJson(res, 200, {
    ok: true,
    source: 'local-only',
    cctv: getCctvCount(),
    targets: targets.count,
    visionAreas: PAPUA_AREAS.length,
    bts: {
      sites: registry.sites.length,
      cells: registry.sites.reduce(
        (sum, site) =>
          sum + (Array.isArray(site.cells) ? site.cells.length : 0),
        0,
      ),
      source: registry.source,
      synthetic: registry.synthetic,
      generatedAt: registry.generatedAt,
      byProvince,
    },
    summary: dashboard?.summary || null,
    generatedAt: dashboard?.generatedAt || null,
  });
}

/**
 * The snapshot the live feed pushes.
 *
 * It is deliberately small: the panel only needs to show that the local
 * picture is current, so the numbers are counts rather than the records.
 */
export async function buildLiveSnapshot() {
  const dashboard = await readArtifact('dashboard-indonesia.json');
  const counts = getCctvCount();
  const targets = await getTargetsByRegion('indonesia');
  const registry = await loadBtsRegistry();
  const summary = dashboard?.summary || {};
  return {
    at: new Date().toISOString(),
    cctv: counts.total,
    cctvByType: counts.byType,
    papuaCameras: counts.papua,
    targets: targets.count,
    visionAreas: PAPUA_AREAS.length,
    btsSites: registry.sites.length,
    btsSource: registry.source,
    news: Number(summary.newsItems) || null,
    papuaNews: Number(summary.papuaNewsItems) || null,
    source: 'local-only',
  };
}

/**
 * GET /api/godseye/stream — server-sent events with the local snapshot.
 *
 * A stream rather than a socket: the panel only ever reads, and SSE reconnects
 * on its own when the dev server restarts mid-session.
 */
async function handleStream(req, res, intervalMs = 15_000) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  let timer = null;
  const stop = () => {
    closed = true;
    if (timer) clearInterval(timer);
  };
  const write = async () => {
    if (closed) return;
    try {
      const snapshot = await buildLiveSnapshot();
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (error) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: error?.message || 'snapshot failed' })}\n\n`,
      );
    }
  };
  await write();
  timer = setInterval(write, intervalMs);
  timer.unref?.();
  req.on?.('close', stop);
  req.on?.('aborted', stop);
  res.on?.('close', stop);
}

/** Mount the local intelligence routes on the Vite dev and preview servers. */
export function installLocalIntel(server) {
  server.middlewares.use('/api/godseye/cctv', (req, res) =>
    handleCctv(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'cctv_failed',
        detail: error?.message || 'the catalog could not be read',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/locate', (req, res) =>
    handleLocate(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'locate_failed',
        detail: error?.message || 'the target could not be resolved',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/score', (req, res) =>
    handleScore(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'score_failed',
        detail: error?.message || 'the score could not be computed',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/anomaly', (req, res) =>
    handleAnomaly(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'anomaly_failed',
        detail: error?.message || 'the track could not be read',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/news', (req, res) =>
    handleNews(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'news_failed',
        detail: error?.message || 'the news could not be read',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/bts', (req, res) =>
    handleBts(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'bts_failed',
        detail: error?.message || 'the registry could not be read',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/export', (req, res) =>
    handleExport(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'export_failed',
        detail: error?.message || 'the export could not be built',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/imagery', (req, res) =>
    handleImagery(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'imagery_failed',
        detail: error?.message || 'the imagery tile could not be fetched',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/verify', (req, res) =>
    handleVerify(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'verify_failed',
        detail: error?.message || 'the height check could not run',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/audit', (req, res) =>
    handleAudit(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'audit_failed',
        detail: error?.message || 'the audit log could not be read',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/capabilities', (req, res) =>
    handleCapabilities(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'capabilities_failed',
        detail: error?.message || 'the capability table could not be built',
      }),
    ),
  );
  server.middlewares.use('/api/godseye/intel', (req, res) =>
    handleIntel(req, res).catch((error) =>
      sendJson(res, 500, {
        ok: false,
        error: 'intel_failed',
        detail: error?.message || 'the summary could not be read',
      }),
    ),
  );
  // The stream keeps its response open, so the handler is started rather than
  // awaited: awaiting it here would hold the middleware forever.
  server.middlewares.use('/api/godseye/stream', (req, res) => {
    handleStream(req, res).catch(() => {
      try {
        res.end();
      } catch {
        /* the client is already gone */
      }
    });
  });
}
