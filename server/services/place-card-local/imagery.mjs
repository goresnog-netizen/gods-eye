/**
 * Imagery and ground truth for an answer.
 *
 * Two jobs, both about not asking the operator to trust a number:
 *
 * 1. **Show the real picture.** Esri World Imagery serves keyless tiles at
 *    sub-metre resolution in towns. The route returns the tile for the exact
 *    coordinate an answer gave, so the panel can put a photograph next to the
 *    coordinate — "here is what is actually at this point".
 *
 * 2. **Cross-check the height.** Two independent elevation models (the local
 *    Terrarium DEM and Open-Meteo's Copernicus DEM) that agree within a few
 *    metres make a height trustworthy. One that disagrees by hundreds of metres
 *    is a warning, and the answer says so instead of picking one silently.
 *
 * Every response carries attribution: Esri and Copernicus both require it, and
 * a tile that has been stripped of its credit is a licence violation the
 * operator would not see.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { elevationAt } from './elevation.mjs';

const ESRI_BASE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const OPEN_METEO_ELEVATION = 'https://api.open-meteo.com/v1/elevation';
const TILE_SIZE = 256;

/** Where fetched tiles are cached; resolved per call like the DEM cache. */
function tileCacheDir() {
  return (
    process.env.GEV_TILE_DIR || path.join(process.cwd(), '.gev-cache/tiles')
  );
}

/** Web Mercator tile indices for a coordinate. Esri numbers rows south-down. */
export function tileIndex(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y, zoom };
}

/** The tile URL Esri serves a coordinate from. */
export function tileUrl(lat, lon, zoom) {
  const { x, y, zoom: z } = tileIndex(lat, lon, zoom);
  return `${ESRI_BASE}/${z}/${y}/${x}`;
}

/** Metres per pixel of one tile — how much ground the picture covers. */
export function metresPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Fetch the real satellite tile for a coordinate.
 *
 * Tiles are cached on disk keyed by their indices, because an operator who
 * re-searches the same place should not pay for the same photograph twice —
 * and because the same tile is shared by every answer inside it.
 */
export function isUsablePoint(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export async function fetchImageryTile(
  lat,
  lon,
  zoom,
  { fetchImpl = null } = {},
) {
  // A point outside the world is refused, not silently wrapped: Esri would
  // answer with a tile from the far side of the planet.
  if (!isUsablePoint(lat, lon)) return null;
  const z = Math.max(0, Math.min(19, Math.round(zoom)));
  const { x, y } = tileIndex(lat, lon, z);
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== 'function') return null;

  const file = path.join(tileCacheDir(), String(z), String(x), `${y}.jpg`);
  let bytes = null;
  try {
    bytes = await readFile(file);
  } catch {
    try {
      const response = await impl(tileUrl(lat, lon, z), {
        headers: { Accept: 'image/jpeg, image/*' },
      });
      if (!response?.ok) return null;
      bytes = Buffer.from(await response.arrayBuffer());
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    } catch {
      return null;
    }
  }
  if (!bytes?.length) return null;

  return {
    url: tileUrl(lat, lon, z),
    zoom: z,
    x,
    y,
    width: TILE_SIZE,
    height: TILE_SIZE,
    bytes,
    contentType: 'image/jpeg',
    groundM: Math.round(metresPerPixel(lat, z) * 100) / 100,
    source: 'esri-world-imagery',
    license: 'Esri terms — attribution required',
    cached: true,
  };
}

/**
 * A second, independent height for a point.
 *
 * Open-Meteo serves Copernicus DEM, which is a different dataset from the
 * Terrarium tiles this console renders terrain from. The two agreeing is the
 * evidence; either one alone is only a claim.
 */
export async function remoteElevation(lat, lon, { fetchImpl = null } = {}) {
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== 'function') return null;
  try {
    const url = `${OPEN_METEO_ELEVATION}?latitude=${lat}&longitude=${lon}`;
    const response = await impl(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response?.ok) return null;
    const payload = await response.json();
    const value = Array.isArray(payload?.elevation)
      ? payload.elevation[0]
      : null;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Compare the local terrain model against an independent one.
 *
 * The verdict is deliberately conservative: 25 m of agreement at these
 * resolutions is normal (a 38 m tile sampled against a 90 m grid), and only a
 * real disagreement is reported as a problem.
 */
export async function verifyHeight(lat, lon, { fetchImpl = null } = {}) {
  const local = await elevationAt(lat, lon);
  const remote = await remoteElevation(lat, lon, { fetchImpl });
  if (!Number.isFinite(local) || !Number.isFinite(remote)) {
    return {
      ok: false,
      localM: Number.isFinite(local) ? Math.round(local) : null,
      remoteM: null,
      deltaM: null,
      verdict: 'one-source-only',
      detail: Number.isFinite(local)
        ? 'Only the local DEM answered; the independent check was unavailable.'
        : 'No elevation source answered for this point.',
    };
  }
  const delta = Math.abs(local - remote);
  let verdict = 'agree';
  let detail = `Two independent DEMs agree within ${Math.round(delta)} m.`;
  if (delta > 100) {
    verdict = 'disagree';
    detail =
      `The local DEM says ${Math.round(local)} m and the independent one says ` +
      `${Math.round(remote)} m — ${Math.round(delta)} m apart. Treat the height as ` +
      'unknown until one of them is corrected.';
  } else if (delta > 25) {
    verdict = 'rough';
    detail =
      `The two DEMs differ by ${Math.round(delta)} m. Usable for planning, not for ` +
      'a claim about a specific building.';
  }
  return {
    ok: verdict !== 'disagree',
    localM: Math.round(local),
    remoteM: Math.round(remote),
    deltaM: Math.round(delta),
    verdict,
    detail,
    sources: ['terrarium-z11 (local)', 'copernicus-dem (open-meteo)'],
  };
}

/** The credit that has to travel with any tile this module returns. */
export function imageryCredit() {
  return {
    text:
      'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community ' +
      '(Powered by Esri). Elevation © Open-Meteo / Copernicus DEM.',
    short: 'Powered by Esri',
    sources: ['esri-world-imagery', 'open-meteo-elevation'],
  };
}
