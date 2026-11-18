/**
 * indonesia.js — real, public camera sources for Indonesia and Papua.
 *
 * The catalog is a committed snapshot produced by
 * `scripts/scan-indonesia-cameras.mjs`. It is intentionally file-backed: a
 * serverless host has a read-only filesystem and a short cold-start budget,
 * and every row has already been verified against its upstream. Regenerate the
 * snapshot with that script instead of adding live network calls here.
 *
 * Two kinds of camera are present, and the UI must not conflate them:
 *  - `atcs-id`               live HLS traffic CCTV from official Dishub portals
 *  - `mapillary-street-image` geotagged street stills (CC BY-SA 4.0)
 *
 * KartaView was evaluated and dropped: its metadata API still answers but every
 * advertised image is dead (`cdn.kartaview.org/pr:sharp/*` → HTTP 500, decoded
 * `storage1.openstreetcam.org` object → 404), so its pins showed no frame.
 *
 * There is NO public live CCTV covering Papua. `liveCctvInPapua: 0` in the
 * coverage report is a measured result, not a missing integration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prioritizeSources } from './normalize.js';

export const DEFAULT_INDONESIA_SOURCES_FILE =
  'config/cctv_sources.indonesia.json';
export const DEFAULT_INDONESIA_MAX_SOURCES = 600;

/** Indonesia's extent, with a little slack for border towns. */
export function isLikelyIndonesiaCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -11.5 &&
    lat <= 6.5 &&
    lon >= 94.5 &&
    lon <= 141.5
  );
}

/** Nearest-first anchors keep a capped catalog spread over the archipelago. */
const ANCHORS = [
  { lat: -6.2, lon: 106.8167 }, // Jakarta
  { lat: -6.9175, lon: 107.6191 }, // Bandung
  { lat: -7.2478, lon: 112.7644 }, // Surabaya
  { lat: -8.6507, lon: 115.2175 }, // Denpasar
  { lat: 3.5833, lon: 98.6667 }, // Medan
  { lat: -5.1621, lon: 119.4341 }, // Makassar
  { lat: -3.3167, lon: 114.59 }, // Banjarmasin
  { lat: -2.5337, lon: 140.7175 }, // Jayapura
  { lat: -0.8763, lon: 131.2558 }, // Sorong
  { lat: -0.8667, lon: 134.0833 }, // Manokwari
  { lat: -3.3667, lon: 135.4833 }, // Nabire
  { lat: -4.1, lon: 138.95 }, // Wamena
  { lat: -4.55, lon: 136.8833 }, // Timika
  { lat: -8.4667, lon: 140.3333 }, // Merauke
];

function maxSources() {
  const raw = Number(
    process.env.CCTV_INDONESIA_MAX_SOURCES || DEFAULT_INDONESIA_MAX_SOURCES,
  );
  return Number.isFinite(raw)
    ? Math.max(1, Math.min(2000, Math.floor(raw)))
    : DEFAULT_INDONESIA_MAX_SOURCES;
}

/**
 * Parse one committed catalog row into a source object. Exported for tests.
 * @param {object} row
 * @returns {?object}
 */
export function indonesiaRowToSource(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const url = String(row.url || '').trim();
  if (!id || !isLikelyIndonesiaCoordinate(lat, lon)) return null;
  if (!/^https:\/\//i.test(url)) return null;
  // A stream the sweep could not open is worse than no pin: the panel would
  // spend a request and then show a dead player. The snapshot records that
  // verdict in `online` (or in the sweep note when the row predates it).
  if (row.online === false) return null;
  if (/^offline at sweep/i.test(String(row.credit || '').trim())) return null;
  return {
    id,
    name: String(row.name || id).trim().slice(0, 160),
    city: String(row.city || ''),
    cityId: String(row.cityId || ''),
    provider: String(row.provider || 'Indonesia open camera source'),
    lat,
    lon,
    headingDeg: Number(row.headingDeg) || 0,
    headingConfidence: String(row.headingConfidence || 'low'),
    pitchDeg: Number(row.pitchDeg) || 0,
    fovDeg: Number(row.fovDeg) || 70,
    rangeM: Number(row.rangeM) || 90,
    mountHeightM: Number(row.mountHeightM) || 2,
    feedType: String(row.feedType || 'image'),
    url,
    snapshotUrl: String(row.snapshotUrl || '').trim(),
    license: String(row.license || ''),
    credit: String(row.credit || '').trim(),
    code: String(row.code || '').trim(),
    sourceKind: String(row.sourceKind || 'indonesia-camera'),
  };
}

/**
 * Live ATCS HLS is opt-in. Both reachable portals (Banjar, Banjarmasin) sit
 * behind a certificate chain Node's fetch refuses — GoGetSSL leaf with a
 * self-signed intermediate, `verify error 19` — so the proxy answers
 * "Live stream unavailable" for every one of them while the raw m3u8 is fine
 * in a browser. Shipping that as a default would mean 51 pins that always fail;
 * set `CCTV_INDONESIA_ATCS=1` once the transport is trusted (pin the
 * intermediate, or front it with a relay that has a valid chain).
 */
function atcsEnabled() {
  return String(process.env.CCTV_INDONESIA_ATCS || '').trim() === '1';
}

/**
 * Load the verified Indonesia/Papua camera catalog.
 * @param {{sourceRoot?: string}} [options]
 * @returns {Array<object>} Prioritized, capped source objects.
 */
export function loadIndonesiaSourcesFromCatalog({
  sourceRoot = process.cwd(),
} = {}) {
  const sourceFile =
    process.env.CCTV_INDONESIA_SOURCES_FILE || DEFAULT_INDONESIA_SOURCES_FILE;
  const resolved = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(sourceRoot, sourceFile);
  let rows = [];
  try {
    if (!fs.existsSync(resolved)) {
      console.warn('[CCTV] Indonesia source file missing:', resolved);
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    rows = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(
      '[CCTV] Indonesia source file read error:',
      error?.message || error,
    );
    return [];
  }

  const cameras = new Map();
  let skippedAtcs = 0;
  for (const row of rows) {
    if (!atcsEnabled() && String(row?.sourceKind) === 'atcs-id') {
      skippedAtcs += 1;
      continue;
    }
    const camera = indonesiaRowToSource(row);
    if (camera && !cameras.has(camera.id)) cameras.set(camera.id, camera);
  }
  const sources = prioritizeSources(
    [...cameras.values()],
    maxSources(),
    ANCHORS,
  );
  console.log(
    `[CCTV] Loaded Indonesia/Papua camera sources: ${cameras.size} (using ${sources.length})` +
      (skippedAtcs ? `; ${skippedAtcs} ATCS live streams held back (CCTV_INDONESIA_ATCS=1 to include)` : ''),
  );
  return sources;
}
