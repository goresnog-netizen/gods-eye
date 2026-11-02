/**
 * Where the tower registry is thin.
 *
 * A coverage percentage says how much ground is served; it does not say where
 * the next probe should go. This module answers that: it walks a grid over the
 * six Papua provinces, asks the registry how far the nearest tower is from each
 * cell centre, and ranks the cells by that distance. The worst cells are the
 * probe targets — a search box placed there buys more registry than one placed
 * where towers already cluster.
 *
 * Pure analysis of data already on disk: no provider call, no credits spent.
 * @module services/place-card-local/bts-gaps
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PAPUA_PROVINCES,
  buildSiteIndex,
  nearestSite,
  provinceOf,
} from './papua-provinces.mjs';

/** Registry artifact written by the probe sweep. */
export const REGISTRY_PATH = 'src/data/place-card-results/bts-registry.json';

/** Default grid: 0.25° is ~28 km, close to a real macro-cell's reach. */
export const DEFAULT_CELL_DEG = 0.25;

/**
 * Grid cells inside the six provinces, each with its distance to the nearest
 * tower.
 *
 * A cell whose centre falls outside every province bbox is skipped, so the
 * report never claims a gap in open sea. Distance comes from the same bucket
 * index the panel uses, so the numbers agree with `?coverage=1`.
 * @param {object[]} sites Registry sites, each with `lat`/`lon`.
 * @param {{cellDeg?: number, index?: object}} [options]
 * @returns {{lat: number, lon: number, province: string, provinceId: string,
 *   nearestKm: number|null, nearestSite: string|null}[]}
 */
export function gapCells(
  sites = [],
  { cellDeg = DEFAULT_CELL_DEG, index } = {},
) {
  const step = Number(cellDeg);
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error('cellDeg must be a positive number');
  }
  const siteIndex = index || buildSiteIndex(sites, 1);
  const cells = [];
  for (const province of PAPUA_PROVINCES) {
    const { south, west, north, east } = province.bbox;
    // Snap to the grid so two provinces sharing a border cannot produce two
    // slightly different cells for the same ground.
    const lat0 = Math.ceil(south / step) * step;
    const lon0 = Math.ceil(west / step) * step;
    for (let lat = lat0; lat <= north; lat += step) {
      for (let lon = lon0; lon <= east; lon += step) {
        const owner = provinceOf(lat, lon);
        if (!owner) continue;
        // Six rings of a 1° bucket reach ~660 km, enough that the emptiest
        // cell still reports a number instead of "none".
        const near = nearestSite(siteIndex, lat, lon, { maxRing: 6 });
        cells.push({
          lat: Number(lat.toFixed(4)),
          lon: Number(lon.toFixed(4)),
          province: owner.name,
          provinceId: owner.id,
          nearestKm: near ? Number(near.distanceKm.toFixed(1)) : null,
          nearestSite: near?.site?.name || null,
        });
      }
    }
  }
  return cells;
}

/**
 * The thinnest cells, furthest from any tower first.
 * @param {object[]} cells Output of {@link gapCells}.
 * @param {{limit?: number, minKm?: number}} [options]
 * @returns {object[]}
 */
export function worstGaps(cells = [], { limit = 20, minKm = 0 } = {}) {
  const floor = Number.isFinite(minKm) ? minKm : 0;
  return cells
    .filter((cell) => cell.nearestKm === null || cell.nearestKm >= floor)
    .sort((a, b) => (b.nearestKm ?? Infinity) - (a.nearestKm ?? Infinity))
    .slice(0, Math.max(0, limit));
}

/**
 * Probe centres for the next sweep, thinned so two boxes do not cover the same
 * ground twice.
 *
 * The probe places a square box per centre, so two centres closer than
 * `minSeparationKm` would buy the same cells twice. Greedy nearest-first
 * thinning keeps the worst cell of each cluster.
 * @param {object[]} cells Output of {@link gapCells}.
 * @param {{limit?: number, minSeparationKm?: number}} [options]
 * @returns {{lat: number, lon: number, province: string, nearestKm: number|null}[]}
 */
export function probePlan(
  cells = [],
  { limit = 40, minSeparationKm = 30 } = {},
) {
  const ranked = worstGaps(cells, { limit: cells.length });
  const chosen = [];
  const minDeg = Math.max(0, minSeparationKm) / 111;
  for (const cell of ranked) {
    if (chosen.length >= limit) break;
    const tooClose = chosen.some(
      (pick) =>
        Math.abs(pick.lat - cell.lat) < minDeg &&
        Math.abs(pick.lon - cell.lon) < minDeg,
    );
    if (tooClose) continue;
    chosen.push({
      lat: cell.lat,
      lon: cell.lon,
      province: cell.province,
      nearestKm: cell.nearestKm,
    });
  }
  return chosen;
}

/** Read the registry artifact from disk. */
export async function loadRegistry(root) {
  const file = path.join(root, REGISTRY_PATH);
  const payload = JSON.parse(await readFile(file, 'utf8'));
  const sites = Array.isArray(payload.sites) ? payload.sites : [];
  return { payload, sites };
}

/** A one-line summary of the gap distribution, for a CLI or a report. */
export function summariseGaps(cells = []) {
  const distances = cells
    .map((cell) => cell.nearestKm)
    .filter((km) => Number.isFinite(km))
    .sort((a, b) => a - b);
  if (!distances.length)
    return { cells: 0, medianKm: null, p90Km: null, worstKm: null };
  const at = (q) =>
    distances[Math.min(distances.length - 1, Math.floor(q * distances.length))];
  return {
    cells: cells.length,
    medianKm: Number(at(0.5).toFixed(1)),
    p90Km: Number(at(0.9).toFixed(1)),
    worstKm: Number(distances[distances.length - 1].toFixed(1)),
  };
}

/** CLI: `npm run bts:gaps [-- --plan] [-- --limit 20]`. */
async function main(argv = process.argv.slice(2)) {
  const plan = argv.includes('--plan');
  const limitFlag = argv.indexOf('--limit');
  const limit = limitFlag >= 0 ? Number(argv[limitFlag + 1]) : plan ? 40 : 20;
  const root = path.resolve(
    fileURLToPath(new URL('../../../', import.meta.url)),
  );
  const { payload, sites } = await loadRegistry(root);
  if (!sites.length) {
    console.error('The registry is empty. Run npm run bts:probe first.');
    return 1;
  }
  const cells = gapCells(sites);
  const summary = summariseGaps(cells);
  console.log(
    `registry ${sites.length} sites · ${summary.cells} grid cells · ` +
      `median ${summary.medianKm} km · p90 ${summary.p90Km} km · worst ${summary.worstKm} km`,
  );
  if (payload?.attribution) console.log(`attribution: ${payload.attribution}`);

  if (!plan) {
    console.log('\nFurthest cells from any tower:');
    for (const gap of worstGaps(cells, { limit })) {
      const km = gap.nearestKm === null ? 'none' : `${gap.nearestKm} km`;
      console.log(
        `  ${gap.lat.toFixed(3)}, ${gap.lon.toFixed(3)}  ${km.padStart(9)}  ${gap.province}`,
      );
    }
    console.log(
      '\nAdd --plan to turn the worst cells into bts:probe commands.',
    );
    return 0;
  }

  console.log('\nProbe plan (worst cell per cluster):');
  console.log(
    'A gap cell is the thinnest part of the registry, not the busiest place:\n' +
      'a remote swamp can be empty because nobody lives there. A probe there\n' +
      'still bounds coverage by confirming the absence.',
  );
  for (const pick of probePlan(cells, { limit })) {
    const label = `${pick.province} gap ${pick.nearestKm ?? '?'}km`;
    console.log(
      `  npm run bts:probe -- --centre ${pick.lat.toFixed(3)},${pick.lon.toFixed(3)} ` +
        `--radius-km 4 --label "${label}"`,
    );
  }
  return 0;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  process.exitCode = await main();
}
