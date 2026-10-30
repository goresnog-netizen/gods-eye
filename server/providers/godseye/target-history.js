import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The local position history behind the time-series and anomaly views.
 *
 * A cell identifier resolves to a different point as the target moves between
 * towers, so recording each lookup builds a track without any provider being
 * asked where the target is. The file is an ordinary local artifact: it lives
 * beside the other generated JSON and never leaves the machine.
 */

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const DEFAULT_FILE = path.join(
  ROOT,
  'src/data/place-card-results/target-history.json',
);
const MAX_POINTS = 120;

/** The history file; tests point this at a temporary path. */
function historyFile() {
  return process.env.GODSEYE_TARGET_HISTORY || DEFAULT_FILE;
}

/** Every track, or an empty map when the file is missing or unreadable. */
export async function readTracks() {
  try {
    const parsed = JSON.parse(await readFile(historyFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** One track, oldest point first. */
export async function historyFor(key) {
  const tracks = await readTracks();
  return Array.isArray(tracks[key]) ? tracks[key] : [];
}

/** The keys that have at least one point, with their point counts. */
export async function listTracks() {
  const tracks = await readTracks();
  return Object.entries(tracks)
    .filter(([, points]) => Array.isArray(points) && points.length)
    .map(([key, points]) => ({
      track: key,
      points: points.length,
      first: points[0]?.timestamp ?? null,
      last: points[points.length - 1]?.timestamp ?? null,
    }))
    .sort((a, b) => (b.last || 0) - (a.last || 0));
}

/**
 * Append a point to a track and return the track as it now stands.
 *
 * A repeated position is not a movement: looking the same cell up twice must
 * not invent a stop-and-go pattern, so consecutive duplicates are dropped.
 *
 * @param {string} key the track, e.g. `cell:510-10`
 * @param {{lat:number, lon:number, timestamp?:number}} point
 * @returns {Promise<Array<{lat:number, lon:number, timestamp:number}>>}
 */
export async function recordPosition(key, point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return historyFor(key);
  const timestamp = Number.isFinite(point?.timestamp)
    ? point.timestamp
    : Date.now();
  const tracks = await readTracks();
  const points = Array.isArray(tracks[key]) ? tracks[key] : [];
  const last = points[points.length - 1];
  if (!last || last.lat !== lat || last.lon !== lon) {
    points.push({ lat, lon, timestamp });
  }
  tracks[key] = points.slice(-MAX_POINTS);
  const file = historyFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(tracks, null, 2)}\n`);
  return tracks[key];
}
