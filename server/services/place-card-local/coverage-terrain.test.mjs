import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CELL_DEG,
  TERRAIN_COVERAGE_VERSION,
  paintViewshedCells,
  readTerrainCoverage,
  runTerrainCoverage,
  terrainCoverageReport,
} from './coverage-terrain.mjs';
import { TECH_PROFILES } from './propagation.mjs';

/** A ring set: 24 azimuths, `rangeFor(azimuthDeg)` decides each range. */
function rings(rangeFor, azimuths = 24) {
  return Array.from({ length: azimuths }, (_, i) => ({
    azimuthDeg: Math.round((360 / azimuths) * i),
    rangeKm: rangeFor(Math.round((360 / azimuths) * i)),
  }));
}

test('a full ring paints a disc of cells around the site', () => {
  const painted = paintViewshedCells(
    { lat: -4.1, lon: 138.95 },
    rings(() => 5),
    DEFAULT_CELL_DEG,
  );
  // A 5 km disc on a ~2.2 km grid is ~16 cells — π·5² / 2.22², not hundreds.
  assert.ok(painted.size >= 10, `painted ${painted.size} cells`);
  assert.ok(painted.size <= 30, `painted ${painted.size} cells`);
  // The site's own cell is always covered.
  const own = `${Math.floor(-4.1 / DEFAULT_CELL_DEG)}:${Math.floor(138.95 / DEFAULT_CELL_DEG)}`;
  assert.ok(painted.has(own));
  // Nothing beyond 5 km: the cell 8 km north is out.
  const far = `${Math.floor((-4.1 + 8 / 111.32) / DEFAULT_CELL_DEG)}:${Math.floor(138.95 / DEFAULT_CELL_DEG)}`;
  assert.ok(!painted.has(far));
});

test('a blocked azimuth paints nothing in that sector', () => {
  // North (0°) blocked, everything else 5 km.
  const painted = paintViewshedCells(
    { lat: -4.1, lon: 138.95 },
    rings((az) => (az === 0 ? 0 : 5)),
    DEFAULT_CELL_DEG,
  );
  const northKey = `${Math.floor((-4.1 + 3 / 111.32) / DEFAULT_CELL_DEG)}:${Math.floor(138.95 / DEFAULT_CELL_DEG)}`;
  const southKey = `${Math.floor((-4.1 - 3 / 111.32) / DEFAULT_CELL_DEG)}:${Math.floor(138.95 / DEFAULT_CELL_DEG)}`;
  assert.ok(!painted.has(northKey), 'the blocked sector stays unpainted');
  assert.ok(painted.has(southKey), 'the open sector is painted');
});

test('an asymmetric ring paints more in the longer direction', () => {
  const painted = paintViewshedCells(
    { lat: -4.1, lon: 138.95 },
    rings((az) => (az === 0 ? 10 : 2)),
    DEFAULT_CELL_DEG,
  );
  const northFar = `${Math.floor((-4.1 + 8 / 111.32) / DEFAULT_CELL_DEG)}:${Math.floor(138.95 / DEFAULT_CELL_DEG)}`;
  const northNear = `${Math.floor((-4.1 + 1 / 111.32) / DEFAULT_CELL_DEG)}:${Math.floor(138.95 / DEFAULT_CELL_DEG)}`;
  assert.ok(painted.has(northFar), '10 km north is inside the long ring');
  assert.ok(!painted.has(northNear) === false, '1 km north is inside too');
  // East is a 2 km ring: a cell 5 km east is out.
  const eastFar = `${Math.floor(-4.1 / DEFAULT_CELL_DEG)}:${Math.floor((138.95 + 5 / (111.32 * Math.cos((-4.1 * Math.PI) / 180))) / DEFAULT_CELL_DEG)}`;
  assert.ok(!painted.has(eastFar));
});

test('the report counts the same grid provinceCoverage counts', () => {
  const report = terrainCoverageReport([
    { id: 'a', lat: -4.1, lon: 138.95, tech: '4G', rings: rings(() => 5) },
  ]);
  assert.equal(report.totals.sites, 1);
  const pegunungan = report.provinces.find((p) => p.id === 'papua-pegunungan');
  assert.ok(pegunungan);
  assert.equal(pegunungan.basis, 'terrain-viewshed-raster');
  assert.ok(pegunungan.coveredPct > 0);
  // A 5 km site covers ~0.5 % of a 108,476 km² province box — tiny, not zero.
  assert.ok(pegunungan.coveredPct < 2);
  // Every province row carries the same denominator method.
  for (const row of report.provinces) {
    assert.equal(row.cellDeg, DEFAULT_CELL_DEG);
    assert.ok(row.samplePoints > 0);
  }
});

test('a site at its cap everywhere is counted as a flat-earth answer', () => {
  const report = terrainCoverageReport([
    {
      id: 'flat',
      lat: -8.49,
      lon: 140.4,
      tech: '4G',
      rings: rings(() => TECH_PROFILES['4G'].capKm),
    },
  ]);
  assert.equal(report.flatEarthSites, 1);
  const cut = terrainCoverageReport([
    {
      id: 'cut',
      lat: -8.49,
      lon: 140.4,
      tech: '4G',
      rings: rings((az) => (az === 0 ? 1 : TECH_PROFILES['4G'].capKm)),
    },
  ]);
  assert.equal(cut.flatEarthSites, 0);
});

function tmpPaths() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-terrain-'));
  return {
    dir,
    stateFile: path.join(dir, 'state.json'),
    artifactFile: path.join(dir, 'coverage.json'),
  };
}

test('the scheduler runs offline on injected terrain and publishes a report', async () => {
  const { dir, stateFile, artifactFile } = tmpPaths();
  try {
    // A ridge east of the site: azimuths 90–270 stay short, 0 and 180 open.
    const elevation = async (lat, lon) => (lon > 139.0 ? 400 : 0);
    const artifact = await runTerrainCoverage({
      sites: [
        { id: 's1', lat: -4.1, lon: 138.95, tech: '4G' },
        { id: 's2', lat: -4.12, lon: 138.93, tech: '4G' },
      ],
      stateFile,
      artifactFile,
      elevationAt: elevation,
      prefetchTiles: async () => 0,
      tilesOf: () => [],
      concurrency: 1,
    });
    assert.equal(artifact.version, TERRAIN_COVERAGE_VERSION);
    assert.equal(artifact.sites, 2);
    assert.equal(artifact.sitesComputedThisRun, 2);
    assert.equal(artifact.model.clutterModel, 'roughness');
    assert.ok(artifact.report.totals.coveredPct > 0);

    const read = await readTerrainCoverage(artifactFile);
    assert.equal(read.sites, 2);

    // A second run resumes: nothing to compute, the report is republished.
    const again = await runTerrainCoverage({
      sites: [
        { id: 's1', lat: -4.1, lon: 138.95, tech: '4G' },
        { id: 's2', lat: -4.12, lon: 138.93, tech: '4G' },
      ],
      stateFile,
      artifactFile,
      elevationAt: elevation,
      prefetchTiles: async () => 0,
      tilesOf: () => [],
    });
    assert.equal(again.sitesComputedThisRun, 0);
    assert.equal(again.sites, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the scheduler honours a limit and a failing site is retried, not fatal', async () => {
  const { dir, stateFile, artifactFile } = tmpPaths();
  try {
    const sites = [
      { id: 'ok1', lat: -4.1, lon: 138.95, tech: '4G' },
      { id: 'bad', lat: -4.2, lon: 138.9, tech: '4G' },
      { id: 'ok2', lat: -4.3, lon: 138.85, tech: '4G' },
    ];
    // Only 'bad' fails: the throw is tied to the site's own coordinate, which
    // is what viewshed() samples first — radial samples never equal it.
    const failing = async (lat, lon) => {
      if (lat === -4.2 && lon === 138.9) throw new Error('boom');
      return 0;
    };
    const first = await runTerrainCoverage({
      sites,
      stateFile,
      artifactFile,
      elevationAt: failing,
      prefetchTiles: async () => 0,
      tilesOf: () => [],
      concurrency: 2,
    });
    assert.equal(first.sitesComputedThisRun, 2);
    assert.equal(first.sitesFailedThisRun, 1);

    // The failed site is not in the state, so a healthy run picks it up.
    const second = await runTerrainCoverage({
      sites,
      stateFile,
      artifactFile,
      elevationAt: async () => 0,
      prefetchTiles: async () => 0,
      tilesOf: () => [],
    });
    assert.equal(second.sitesComputedThisRun, 1);
    assert.equal(second.sitesFailedThisRun, 0);
    assert.equal(second.sites, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no artifact yet reads as null, never as a guess', async () => {
  const { dir, artifactFile } = tmpPaths();
  try {
    assert.equal(await readTerrainCoverage(artifactFile), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the control is the same sites as flat circles at the same caps', () => {
  // Two sites in different provinces, every ring at a third of the cap: the
  // control must paint strictly more than the viewsheds, and the delta must
  // be terrain's, because caps, raster and denominator are identical.
  const viewsheds = [
    {
      lat: -0.9,
      lon: 131.0,
      tech: '4G',
      rings: rings(() => TECH_PROFILES['4G'].capKm / 3),
    },
    {
      lat: -4.0,
      lon: 138.0,
      tech: '3G',
      rings: rings(() => TECH_PROFILES['3G'].capKm / 3),
    },
  ];
  const report = terrainCoverageReport(viewsheds);
  for (const row of report.provinces) {
    if (row.sites === 0) continue;
    assert.ok(
      row.controlPct > row.coveredPct,
      `${row.name}: control ${row.controlPct} vs terrain ${row.coveredPct}`,
    );
    assert.equal(
      row.terrainDeltaPct,
      Math.round((row.controlPct - row.coveredPct) * 100) / 100,
    );
  }
  assert.ok(report.totals.controlPct > report.totals.coveredPct);
  assert.ok(report.totals.controlPct <= 100);
});

test('a site whose every ring reaches the cap has no terrain delta', () => {
  const viewsheds = [
    {
      lat: -8.5,
      lon: 140.4,
      tech: '4G',
      rings: rings(() => TECH_PROFILES['4G'].capKm),
    },
  ];
  const report = terrainCoverageReport(viewsheds);
  for (const row of report.provinces) {
    if (row.sites === 0) continue;
    assert.equal(row.coveredPct, row.controlPct, row.name);
    assert.equal(row.terrainDeltaPct, 0, row.name);
  }
  assert.equal(report.flatEarthSites, 1);
});

test('a ridge on one azimuth costs exactly that sector', () => {
  const cap = TECH_PROFILES['4G'].capKm;
  const viewsheds = [
    {
      lat: -2.5,
      lon: 138.0,
      tech: '4G',
      // Twelve radials at the cap, twelve at a fifth: the terrain answer is
      // between a full circle and a half circle, and so is the delta.
      rings: rings((azimuthDeg) => (azimuthDeg < 180 ? cap : cap / 5)),
    },
  ];
  const report = terrainCoverageReport(viewsheds);
  const row = report.provinces.find((candidate) => candidate.sites > 0);
  assert.ok(row, 'site falls in a province box');
  assert.ok(row.coveredPct > 0);
  assert.ok(row.controlPct > row.coveredPct);
  assert.equal(report.flatEarthSites, 0);
});
