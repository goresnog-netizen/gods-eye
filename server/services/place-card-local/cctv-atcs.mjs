/**
 * cctv-atcs.mjs — real public traffic cameras collected from Indonesian ATCS
 * portals (scripts/fetch-atcs.mjs writes .gev-cache/atcs-catalog.json).
 *
 * Every camera here is real: it was served by an official `atcs.<city>.go.id`
 * portal. `live` is a real HLS manifest check done at collection time; the
 * front end can re-check by fetching the m3u8 before playing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(
  __dirname,
  '../../../.gev-cache/atcs-catalog.json',
);
// Committed snapshot: the catalog is usable on a fresh clone without running
// the collector again. The live cache (if present) wins because it is newer.
const SNAPSHOT_FILE = path.resolve(__dirname, 'cctv-atcs-catalog.json');

/** Slug -> readable city label. */
const CITY_LABELS = {
  banjarkota: 'Banjar (Jawa Barat)',
  banjarmasinkota: 'Banjarmasin',
};

let cached = null;

/** Parse the collector cache into a normalized camera array. */
export function loadAtcsCameras() {
  if (cached) return cached;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    try {
      raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    } catch {
      cached = [];
      return cached;
    }
  }
  const cameras = [];
  for (const city of Array.isArray(raw?.cities) ? raw.cities : []) {
    const label = CITY_LABELS[city.domain] || city.domain;
    for (const cam of Array.isArray(city.camerasList) ? city.camerasList : []) {
      if (!cam?.name) continue;
      cameras.push({
        id: cam.id,
        name: cam.name,
        lat: Number.isFinite(cam.lat) ? cam.lat : null,
        lon: Number.isFinite(cam.lon) ? cam.lon : null,
        city: label,
        provider: 'atcs',
        type: 'traffic',
        source: cam.source,
        streamUrl: cam.streamUrl || null,
        posterUrl: cam.posterUrl || null,
        live: Boolean(cam.live),
      });
    }
  }
  cameras.sort((a, b) => (a.city < b.city ? -1 : a.city > b.city ? 1 : 0));
  cached = cameras;
  return cached;
}

/** Counts for the catalog summary. */
export function getAtcsCount() {
  const cams = loadAtcsCameras();
  const cities = {};
  for (const c of cams) {
    cities[c.city] = (cities[c.city] || 0) + 1;
  }
  return {
    total: cams.length,
    live: cams.filter((c) => c.live).length,
    cities,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const count = getAtcsCount();
  console.log(
    JSON.stringify({ ...count, cameras: loadAtcsCameras() }, null, 2),
  );
}
