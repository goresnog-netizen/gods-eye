/**
 * Terrain elevation, from the keyless AWS "terrarium" tiles.
 *
 * Every coverage number in this console used to be a circle: a 4G cell was
 * "5 km" in all directions, which in Papua is wrong in both directions — a
 * ridge 1.2 km away blocks the valley behind it, while a ridge-top site reaches
 * 15 km down the same valley. A circle cannot say either.
 *
 * The tiles are 256×256 PNGs of packed elevation:
 *
 *     height_m = (R * 256 + G + B / 256) - 32768
 *
 * Zoom 11 is ~76 m per pixel at the equator — enough to see the ridges that
 * decide coverage, small enough to fetch a few tiles per site.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
/**
 * Where decoded tiles live, resolved per call.
 *
 * ESM evaluates imports before the importing module's body runs, so a const
 * here would capture the environment before a test could point it at a
 * temporary directory — and the suite would then read whatever tiles happen to
 * be cached on the developer's machine.
 */
export function demCacheDir() {
  return process.env.GEV_DEM_DIR || path.join(ROOT, '.gev-cache/dem');
}
export const TERRARIUM_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const DEFAULT_ZOOM = 11;

/** Fractional tile coordinates for a coordinate, at a zoom level. */
export function lonLatToTile(lat, lon, zoom = DEFAULT_ZOOM) {
  const size = 2 ** zoom;
  const x = ((lon + 180) / 360) * size;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    size;
  return { x, y, size };
}

/** The tile that contains a coordinate, and the pixel inside it. */
export function tileFor(lat, lon, zoom = DEFAULT_ZOOM) {
  const { x, y } = lonLatToTile(lat, lon, zoom);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return {
    z: zoom,
    x: tx,
    y: ty,
    px: (x - tx) * 256,
    py: (y - ty) * 256,
  };
}

/** Metres per pixel at a latitude, for the tile grid. */
export function metresPerPixel(lat, zoom = DEFAULT_ZOOM) {
  const circumference = 40075016.686;
  return (circumference * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

/**
 * A terrarium PNG → a Float32Array of metres.
 *
 * `sharp` is already a dependency of this repo (it decodes the PNG); the
 * elevation arithmetic is the part that has to be exact, so it is here and
 * tested rather than hidden in a library.
 */
export async function decodeTerrarium(buffer) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixels = new Float32Array(info.width * info.height);
  for (let i = 0; i < pixels.length; i += 1) {
    const base = i * channels;
    const red = data[base];
    const green = data[base + 1];
    const blue = data[base + 2];
    pixels[i] = red * 256 + green + blue / 256 - 32768;
  }
  return { width: info.width, height: info.height, pixels };
}

/**
 * The tiles a circle of `radiusKm` around a point touches, at a zoom level.
 *
 * Same geometry `prefetchArea` uses, exported so a batch caller (the terrain
 * coverage scheduler) can union the tiles of many sites and fetch each one
 * once instead of once per site.
 */
export function tilesAround(lat, lon, radiusKm, { zoom = DEFAULT_ZOOM } = {}) {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return [];
  const dLat = radiusKm / 111.32;
  const dLon =
    radiusKm / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const northWest = tileFor(lat + dLat, lon - dLon, zoom);
  const southEast = tileFor(lat - dLat, lon + dLon, zoom);
  const tiles = [];
  for (let x = northWest.x; x <= southEast.x; x += 1) {
    for (let y = northWest.y; y <= southEast.y; y += 1) {
      tiles.push([zoom, x, y]);
    }
  }
  return tiles;
}

/**
 * Load a set of tiles with a bounded number of requests in flight.
 *
 * S3 answers parallel requests fine, but a few hundred concurrent connections
 * from one process earns throttling — and a throttled tile reads as "terrain
 * unknown", which is a *wrong* answer rather than a slow one. `concurrency`
 * keeps the burst polite; the disk cache still does the deduplicating.
 */
export async function prefetchTiles(
  tiles = [],
  { concurrency = 8, maxTiles = 4096, fetchImpl = null } = {},
) {
  const list = (Array.isArray(tiles) ? tiles : []).slice(0, maxTiles);
  let index = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, list.length || 1)) },
    async () => {
      while (index < list.length) {
        const [z, x, y] = list[index];
        index += 1;
        await loadTile(z, x, y, { fetchImpl });
      }
    },
  );
  await Promise.all(workers);
  return list.length;
}

/**
 * Load every tile a viewshed of `radiusKm` will touch, in parallel.
 *
 * A 20 km viewshed at zoom 11 spans a 2×2 block of tiles. Fetching them one
 * *sample* at a time — which is what a radial walk does — pays the network and
 * the PNG decode inside the innermost loop, so a first click costs seconds.
 * Loading the block up front turns that into one round of parallel fetches,
 * after which every lookup is a memory hit.
 *
 * The block is capped: a radius wider than the cap would ask for hundreds of
 * tiles, and a caller that wants that should raise the zoom, not the radius.
 */
export async function prefetchArea(
  lat,
  lon,
  radiusKm,
  { zoom = DEFAULT_ZOOM, fetchImpl = null, maxTiles = 64 } = {},
) {
  const wanted = tilesAround(lat, lon, radiusKm, { zoom }).slice(0, maxTiles);
  await Promise.all(
    wanted.map(([z, x, y]) => loadTile(z, x, y, { fetchImpl })),
  );
  return wanted.length;
}

/** Bilinear sample from a decoded tile; clamps at the edges. */
export function sampleTile(tile, px, py) {
  const x = Math.max(0, Math.min(tile.width - 1.001, px));
  const y = Math.max(0, Math.min(tile.height - 1.001, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix, iy) =>
    tile.pixels[
      Math.min(tile.height - 1, iy) * tile.width + Math.min(tile.width - 1, ix)
    ];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

const tileCache = new Map();
const MAX_CACHED_TILES = 48;

async function loadTile(z, x, y, { fetchImpl = null } = {}) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const file = path.join(demCacheDir(), String(z), String(x), `${y}.png`);
  let buffer = null;
  try {
    buffer = await readFile(file);
  } catch {
    // An injected fetch is a deliberate seam and is always honoured; the
    // offline switch only guards the real network, so "no cache and no
    // network" means "terrain unknown" — which the caller handles by falling
    // back to the planning radius.
    const impl =
      fetchImpl ||
      (process.env.GEV_DEM_OFFLINE === '1' ? null : globalThis.fetch);
    if (typeof impl !== 'function') return null;
    try {
      const response = await impl(TERRARIUM_URL(z, x, y), {
        headers: { Accept: 'image/png' },
      });
      if (!response.ok) return null;
      buffer = Buffer.from(await response.arrayBuffer());
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, buffer);
    } catch {
      return null;
    }
  }
  let tile = null;
  try {
    tile = await decodeTerrarium(buffer);
  } catch {
    return null;
  }
  if (tileCache.size >= MAX_CACHED_TILES) {
    tileCache.delete(tileCache.keys().next().value);
  }
  tileCache.set(key, tile);
  return tile;
}

/**
 * Elevation in metres at a coordinate, or null when the tile is unavailable.
 *
 * A missing tile is not an error: the caller treats it as "unknown terrain"
 * and falls back to the flat-earth planning radius, which is the honest
 * answer when the ground truth is missing.
 */
export async function elevationAt(
  lat,
  lon,
  { zoom = DEFAULT_ZOOM, fetchImpl = null } = {},
) {
  const spot = tileFor(lat, lon, zoom);
  const tile = await loadTile(spot.z, spot.x, spot.y, { fetchImpl });
  if (!tile) return null;
  return sampleTile(tile, spot.px, spot.py);
}

/** Terrain heights along a straight line, for a path profile. */
export async function elevationProfile(
  a,
  b,
  { steps = 64, zoom = DEFAULT_ZOOM, fetchImpl } = {},
) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const lat = a.lat + (b.lat - a.lat) * t;
    const lon = a.lon + (b.lon - a.lon) * t;
    const height = await elevationAt(lat, lon, { zoom, fetchImpl });
    points.push({ lat, lon, elevationM: height });
  }
  return points;
}

/** Clear the in-memory tile cache (tests, or after changing zoom). */
export function clearTileCache() {
  tileCache.clear();
}
