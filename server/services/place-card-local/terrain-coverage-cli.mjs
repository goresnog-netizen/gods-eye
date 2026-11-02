#!/usr/bin/env node
/**
 * Terrain-aware coverage over the whole BTS registry.
 *
 *   node server/services/place-card-local/terrain-coverage-cli.mjs
 *   node server/services/place-card-local/terrain-coverage-cli.mjs --limit 200
 *   node server/services/place-card-local/terrain-coverage-cli.mjs --clutter roughness --tilt 4
 *
 * One viewshed per site (24 radials, knife-edge diffraction, land-cover clutter
 * by default — ESA WorldCover 10 m, keyless; `--clutter roughness` keeps the old
 * terrain-grade proxy, `--clutter flat` the planning circle), resumable through
 * `.gev-cache/terrain-coverage-state.json`
 * and published to `.gev-cache/terrain-coverage.json`, which
 * `GET /api/godseye/bts?coverage=1&terrain=1` serves. Without a prior run the
 * route says "not computed" — this file is what makes the number exist.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTerrainCoverage } from './coverage-terrain.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

async function loadRegistry() {
  const override = process.env.GODSEYE_BTS_REGISTRY;
  const file = override
    ? path.resolve(override)
    : path.join(ROOT, 'src/data/place-card-results/bts-registry.json');
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  const sites = Array.isArray(parsed?.sites) ? parsed.sites : [];
  if (!sites.length) {
    throw new Error(
      `no sites in ${file} — import a registry first (bts:sweep / bts:probe)`,
    );
  }
  return sites;
}

async function main() {
  const limit = Number(arg('limit', 0)) || 0;
  const clutterModel = String(arg('clutter', 'landcover'));
  const tiltDeg = Number(arg('tilt', 0)) || 0;
  const concurrency = Number(arg('concurrency', 2)) || 2;
  const sites = await loadRegistry();
  console.log(
    `terrain coverage: ${sites.length} sites · clutter=${clutterModel} tilt=${tiltDeg}° concurrency=${concurrency}${limit ? ` · limit=${limit}` : ''}`,
  );
  const started = Date.now();
  const artifact = await runTerrainCoverage({
    sites,
    clutterModel,
    tiltDeg,
    concurrency,
    limit,
    onProgress: (event) => {
      if (event.ok === false) {
        const where = event.site || `chunk(${(event.chunk || []).length})`;
        const stage = event.stage ? ` [${event.stage}]` : '';
        console.log(`  ! ${where}${stage}: ${event.error}`);
      } else if (event.done !== undefined) {
        console.log(
          `  … ${event.done} computed, ${event.failed} failed, ${event.pending ?? 0} pending`,
        );
      }
    },
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  console.log(
    `computed ${artifact.sitesComputedThisRun} sites this run (${artifact.sitesFailedThisRun} failed), ${artifact.sites} total, in ${seconds}s`,
  );
  console.log(
    `flat-earth sites (every ring at cap): ${artifact.report.flatEarthSites}`,
  );
  for (const row of artifact.report.provinces) {
    console.log(
      `  ${row.name.padEnd(18)} ${String(row.coveredPct).padStart(6)} % of box (${row.sites} sites)`,
    );
  }
  console.log(`published → .gev-cache/terrain-coverage.json`);
}

main().catch((error) => {
  console.error(`terrain coverage failed: ${error?.message || error}`);
  process.exitCode = 1;
});
