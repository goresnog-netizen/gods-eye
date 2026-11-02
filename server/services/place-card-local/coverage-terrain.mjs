/**
 * Terrain-aware coverage — what the registry covers once the ground has a say.
 *
 * `provinceCoverage` (papua-provinces.mjs) answers with planning circles: a
 * site paints every cell inside its planning radius, flat earth assumed. That
 * is the honest answer when nothing else is known, and it is what the panel
 * has shown so far. This module answers the harder question: the same
 * registry, with each site replaced by the polygon the terrain actually
 * allows — 24 radials of knife-edge diffraction and, optionally, roughness
 * clutter (propagation.mjs).
 *
 * Two things make it a module and not a route:
 *
 *   1. **It is a batch job.** One viewshed per site is ~40–400 ms warm and
 *      seconds cold; the whole registry is ~2,000 sites and a few thousand DEM
 *      tiles. That is a scheduler, resumable, not a request handler.
 *   2. **The answer must stay comparable.** The report carries its own
 *      flat-earth control — the same sites as circles at the same technology
 *      caps — so the delta between the two numbers is terrain's own
 *      contribution and nothing else. (`provinceCoverage`'s registry-range
 *      circles are a different measurement: observed cell spread, median
 *      1 km. Useful, but never to be read as a coverage claim.)
 *
 * State lives in `.gev-cache/terrain-coverage-state.json` (per-site rings,
 * resumable) and the published answer in `.gev-cache/terrain-coverage.json`
 * (the report the route serves). Neither is a source of truth about towers;
 * the registry is. This file only says how far the ground lets each tower be
 * heard.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { viewshed, TECH_PROFILES } from './propagation.mjs';
import {
  elevationAt,
  prefetchTiles,
  tileFor,
  tilesAround,
} from './elevation.mjs';
import { PAPUA_PROVINCES, provinceOf, distanceKm } from './papua-provinces.mjs';
import { bearing } from './bts-registry.mjs';

export const TERRAIN_COVERAGE_VERSION = 1;

/** The same ~2.2 km raster `provinceCoverage` paints, so the deltas are real. */
export const DEFAULT_CELL_DEG = 0.02;

/** The technology profile a site is planned with; unknown techs get the 4G one. */
function profileFor(site) {
  return (
    TECH_PROFILES[String(site?.tech || '').toUpperCase()] ||
    TECH_PROFILES.unknown
  );
}

/**
 * Sites per prefetch chunk. Neighbouring sites share most of their tiles, so
 * the union of a chunk is far smaller than the sum of its blocks — and one
 * bounded burst of fetches per chunk is politer to the tile server than one
 * burst per site.
 */
export const DEFAULT_CHUNK_SITES = 20;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function defaultStateFile() {
  return (
    process.env.GEV_TERRAIN_COVERAGE_STATE ||
    path.join(ROOT, '.gev-cache/terrain-coverage-state.json')
  );
}

export function defaultArtifactFile() {
  return (
    process.env.GEV_TERRAIN_COVERAGE_FILE ||
    path.join(ROOT, '.gev-cache/terrain-coverage.json')
  );
}

/**
 * The grid cells one site's viewshed reaches.
 *
 * A cell is covered when its distance from the site is within the range of the
 * ring whose sector its bearing falls in. The ring count is the azimuth count
 * the viewshed was computed with, so a 24-ring polygon is painted at its own
 * 15° resolution — no pretending between the radials.
 */
export function paintViewshedCells(
  site,
  rings = [],
  cellDeg = DEFAULT_CELL_DEG,
) {
  const painted = new Set();
  const usable = rings.filter(
    (ring) => Number.isFinite(ring?.rangeKm) && ring.rangeKm > 0,
  );
  if (!usable.length || !Number.isFinite(site?.lat)) return painted;
  const maxKm = Math.max(...usable.map((ring) => ring.rangeKm));
  if (!(maxKm > 0)) return painted;
  const step = 360 / rings.length;
  const dLat = maxKm / 111.32;
  const dLon =
    maxKm / (111.32 * Math.max(0.05, Math.cos((site.lat * Math.PI) / 180)));
  const south = Math.floor((site.lat - dLat) / cellDeg);
  const north = Math.ceil((site.lat + dLat) / cellDeg);
  const west = Math.floor((site.lon - dLon) / cellDeg);
  const east = Math.ceil((site.lon + dLon) / cellDeg);
  for (let i = south; i <= north; i += 1) {
    const lat = (i + 0.5) * cellDeg;
    for (let j = west; j <= east; j += 1) {
      const lon = (j + 0.5) * cellDeg;
      const d = distanceKm(site.lat, site.lon, lat, lon);
      if (d > maxKm) continue;
      const deg = ((bearing(site.lat, site.lon, lat, lon) % 360) + 360) % 360;
      const index = Math.round(deg / step) % rings.length;
      const ring = rings[index];
      if (Number.isFinite(ring?.rangeKm) && d <= ring.rangeKm) {
        painted.add(`${i}:${j}`);
      }
    }
  }
  return painted;
}

/**
 * The report: per province, how much of its box the viewsheds reach.
 *
 * Two numbers are published per province, and the difference between them is
 * the whole point:
 *
 *   `coveredPct`  — the terrain viewsheds: knife-edge diffraction, roughness
 *                   clutter, real DEM. What the ground allows.
 *   `controlPct`  — the same sites as full circles at the same technology
 *                   caps. Flat earth. What the ground would allow if Papua
 *                   were a table.
 *
 * The delta is terrain's own contribution, because nothing else differs —
 * same sites, same caps, same raster, same denominator. (`provinceCoverage`'s
 * registry-range circles are a *third* number — observed cell spread, median
 * 1 km — and must never be presented as either of these two.)
 *
 * The denominator is the province's own cells on the same grid
 * `provinceCoverage` uses. `basis` says which method produced the number so a
 * reader never has to guess.
 */
export function terrainCoverageReport(
  viewsheds = [],
  { cellDeg = DEFAULT_CELL_DEG } = {},
) {
  const painted = new Set();
  const control = new Set();
  let used = 0;
  let flatEarth = 0;
  for (const entry of viewsheds) {
    if (!entry?.rings?.length) continue;
    const site = { lat: entry.lat, lon: entry.lon };
    for (const key of paintViewshedCells(site, entry.rings, cellDeg)) {
      painted.add(key);
    }
    // The control: the same site as a circle at its technology cap.
    const capKm = profileFor({ tech: entry.tech }).capKm;
    const flatRings = entry.rings.map((ring) => ({
      azimuthDeg: ring.azimuthDeg,
      rangeKm: capKm,
    }));
    for (const key of paintViewshedCells(site, flatRings, cellDeg)) {
      control.add(key);
    }
    used += 1;
    const allAtCap = entry.rings.every(
      (ring) => Math.abs((ring.rangeKm ?? 0) - capKm) < 0.01,
    );
    if (allAtCap) flatEarth += 1;
  }

  const provinces = PAPUA_PROVINCES.map((province) => {
    let areaCells = 0;
    let coveredCells = 0;
    let controlCells = 0;
    const south = Math.floor(province.bbox.south / cellDeg);
    const north = Math.ceil(province.bbox.north / cellDeg);
    const west = Math.floor(province.bbox.west / cellDeg);
    const east = Math.ceil(province.bbox.east / cellDeg);
    for (let i = south; i <= north; i += 1) {
      for (let j = west; j <= east; j += 1) {
        const key = `${i}:${j}`;
        areaCells += 1;
        if (painted.has(key)) coveredCells += 1;
        if (control.has(key)) controlCells += 1;
      }
    }
    const own = viewsheds.filter(
      (entry) => provinceOf(entry.lat, entry.lon)?.id === province.id,
    );
    const coveredPct = areaCells
      ? Math.round((coveredCells / areaCells) * 10000) / 100
      : null;
    const controlPct = areaCells
      ? Math.round((controlCells / areaCells) * 10000) / 100
      : null;
    return {
      id: province.id,
      name: province.name,
      capital: province.capital,
      capitalLat: province.capitalLat,
      capitalLon: province.capitalLon,
      areaKm2: province.areaKm2,
      sites: own.length,
      samplePoints: areaCells,
      coveredPoints: coveredCells,
      coveredPct,
      controlPoints: controlCells,
      controlPct,
      // What the mountains take away, in points of the same denominator.
      terrainDeltaPct:
        coveredPct === null || controlPct === null
          ? null
          : Math.round((controlPct - coveredPct) * 100) / 100,
      basis: 'terrain-viewshed-raster',
      controlBasis: 'flat-earth-cap-circles',
      cellDeg,
    };
  });

  const totalPoints = provinces.reduce((sum, row) => sum + row.samplePoints, 0);
  const totalCovered = provinces.reduce(
    (sum, row) => sum + row.coveredPoints,
    0,
  );
  const totalControl = provinces.reduce(
    (sum, row) => sum + row.controlPoints,
    0,
  );
  return {
    provinces,
    totals: {
      sites: used,
      samplePoints: totalPoints,
      coveredPoints: totalCovered,
      coveredPct: totalPoints
        ? Math.round((totalCovered / totalPoints) * 10000) / 100
        : null,
      controlPoints: totalControl,
      controlPct: totalPoints
        ? Math.round((totalControl / totalPoints) * 10000) / 100
        : null,
      cellDeg,
    },
    // A site whose every ring reached its cap is a flat-earth answer: either
    // the ground really is flat (Merauke) or the DEM was unavailable. The
    // share of such sites is the honest health check of a run.
    flatEarthSites: flatEarth,
  };
}

/** Ring pairs are stored compact: [azimuthDeg, rangeKm]. */
function compactRings(rings) {
  return rings.map((ring) => [
    ring.azimuthDeg,
    ring.rangeKm,
    Math.round((ring.obstructionDb ?? 0) * 10) / 10,
  ]);
}

function expandRings(rings) {
  if (!Array.isArray(rings)) return [];
  return rings
    .filter((ring) => Array.isArray(ring) && ring.length >= 2)
    .map(([azimuthDeg, rangeKm, obstructionDb]) => ({
      azimuthDeg,
      rangeKm,
      obstructionDb: obstructionDb ?? 0,
    }));
}

async function readState(stateFile) {
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8'));
    if (parsed?.version === TERRAIN_COVERAGE_VERSION && parsed.viewsheds) {
      return parsed;
    }
  } catch {
    // A missing or stale state file is a first run, not an error.
  }
  return { version: TERRAIN_COVERAGE_VERSION, viewsheds: {}, updatedAt: null };
}

async function writeState(stateFile, state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, stateFile);
}

/**
 * Compute (or resume) terrain-aware viewsheds for every site, then publish
 * the report.
 *
 * Sites are sorted geographically and processed in chunks: each chunk
 * prefetches the *union* of its tiles once (bounded concurrency — a throttled
 * tile would silently read as "terrain unknown"), then computes its viewsheds
 * from the warm cache. State is rewritten per chunk, so an interrupted run
 * resumes instead of restarting.
 */
export async function runTerrainCoverage({
  sites = [],
  stateFile = defaultStateFile(),
  artifactFile = defaultArtifactFile(),
  clutterModel = 'roughness',
  tiltDeg = 0,
  azimuths = 24,
  stepM = 300,
  concurrency = 2,
  chunkSites = DEFAULT_CHUNK_SITES,
  tileConcurrency = 8,
  limit = 0,
  elevationAt: elev = elevationAt,
  tilesAround: tilesOf = tilesAround,
  prefetch: fetchTiles = prefetchTiles,
  onProgress = () => {},
  now = () => new Date().toISOString(),
} = {}) {
  const state = await readState(stateFile);
  const pending = sites
    .filter(
      (site) =>
        Number.isFinite(site?.lat) &&
        Number.isFinite(site?.lon) &&
        !state.viewsheds[site.id],
    )
    // Geographic order: neighbouring sites share tiles, so the chunk union is
    // small and the disk cache does the deduplicating.
    .sort((a, b) => {
      const ta = tileFor(a.lat, a.lon);
      const tb = tileFor(b.lat, b.lon);
      return (
        ta.y - tb.y || ta.x - tb.x || String(a.id).localeCompare(String(b.id))
      );
    });
  const queue = limit > 0 ? pending.slice(0, limit) : pending;
  const chunks = [];
  for (let i = 0; i < queue.length; i += chunkSites) {
    chunks.push(queue.slice(i, i + chunkSites));
  }

  let done = 0;
  let failed = 0;
  let chunkIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, chunks.length || 1)) },
    async () => {
      while (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex];
        chunkIndex += 1;
        try {
          // One bounded burst for the whole chunk's terrain, before any walk.
          const tiles = new Map();
          for (const site of chunk) {
            const profile = profileFor(site);
            for (const tile of tilesOf(site.lat, site.lon, profile.capKm)) {
              tiles.set(tile.join('/'), tile);
            }
          }
          if (tiles.size) {
            await fetchTiles([...tiles.values()], {
              concurrency: tileConcurrency,
            });
          }
        } catch (error) {
          // A failed prefetch is not fatal: the walks still run, and any tile
          // that is genuinely missing reads as "terrain unknown" — sea level,
          // which over-reports range, the safe direction.
          onProgress({
            chunk: chunk.map((site) => site.id),
            ok: false,
            stage: 'prefetch',
            error: String(error?.message || error),
          });
        }
        for (const site of chunk) {
          const profile = profileFor(site);
          try {
            const result = await viewshed({
              site: {
                id: site.id,
                lat: site.lat,
                lon: site.lon,
                heightM: site.heightM ?? 30,
              },
              profile,
              elevationAt: elev,
              azimuths,
              stepM,
              clutterModel,
              tiltDeg,
            });
            if (!result.ok) throw new Error(result.error || 'viewshed_failed');
            state.viewsheds[site.id] = {
              lat: site.lat,
              lon: site.lon,
              tech: site.tech || 'unknown',
              groundM: result.site.groundM,
              rings: compactRings(result.rings),
              at: now(),
            };
            done += 1;
          } catch (error) {
            // One bad site must not lose the run: leave it out of the state so
            // the next pass retries it, and count it.
            failed += 1;
            onProgress({
              site: site.id,
              ok: false,
              error: String(error?.message || error),
            });
          }
        }
        state.updatedAt = now();
        await writeState(stateFile, state);
        onProgress({
          done,
          failed,
          pending: queue.length - done - failed,
          chunk: chunk.length,
        });
      }
    },
  );
  await Promise.all(workers);
  state.updatedAt = now();
  await writeState(stateFile, state);

  const viewsheds = Object.entries(state.viewsheds).map(([id, entry]) => ({
    id,
    ...entry,
    rings: expandRings(entry.rings),
  }));
  const report = terrainCoverageReport(viewsheds);
  const artifact = {
    version: TERRAIN_COVERAGE_VERSION,
    computedAt: now(),
    model: {
      clutterModel,
      clutterBasis:
        clutterModel === 'roughness' ? 'terrain-roughness-proxy' : 'flat',
      tiltDeg,
      azimuths,
      stepM,
      dem: 'terrarium-z11',
    },
    sites: viewsheds.length,
    sitesComputedThisRun: done,
    sitesFailedThisRun: failed,
    report,
  };
  await mkdir(path.dirname(artifactFile), { recursive: true });
  const tmp = `${artifactFile}.tmp`;
  await writeFile(tmp, JSON.stringify(artifact));
  await rename(tmp, artifactFile);
  // The final event must carry the same shape as the per-chunk ones: a
  // handler that prints `pending` would otherwise say "undefined" on a run
  // that had nothing left to compute.
  onProgress({ done, failed, pending: 0, published: artifactFile });
  return artifact;
}

/** Read the published report, or null when no run has happened yet. */
export async function readTerrainCoverage(
  artifactFile = defaultArtifactFile(),
) {
  try {
    const parsed = JSON.parse(await readFile(artifactFile, 'utf8'));
    if (parsed?.version === TERRAIN_COVERAGE_VERSION && parsed.report) {
      return parsed;
    }
  } catch {
    // Not computed yet — the caller reports "not computed", never a guess.
  }
  return null;
}
