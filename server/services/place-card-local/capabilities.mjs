/**
 * What this console can actually do, stated once and checked by the routes.
 *
 * Every feature below is either measured, estimated from a local catalogue, or
 * blocked on something a machine cannot supply (a key, a lawful feed). The
 * point of the table is that nobody has to guess which: `/api/godseye/
 * capabilities` answers it with numbers from the live registry.
 *
 * The distinction that matters most is `real` vs `catalog`:
 *
 *   real     — derived from data about the world (OpenCellID cells, a model's
 *              output, the position the device reported)
 *   estimate — real geometry over incomplete data (a planning radius, no
 *              terrain, no clutter)
 *   catalog  — a curated local sample, useful for a demo and never for a claim
 *   blocked  — needs a key or a lawful agreement before it can exist
 *
 * `phone-locate` is the one people ask about first, so it says plainly that a
 * phone number is not a position: only the network knows where a handset is,
 * and it only tells a lawful request.
 */

const BTS_LICENSE = 'OpenCelliD, CC BY-SA 4.0';

/**
 * @param {object} facts  live counts, so the table cannot drift from the app
 * @param {object} facts.bts      { sites, cells, source, synthetic }
 * @param {object} facts.cctv     { total, papua, byType }
 * @param {object} facts.targets  { count }
 * @param {object} facts.news     { total, papua } | null
 * @param {object} facts.vision   { areas }
 * @param {object} facts.terrain  { known } — whether the DEM answers
 * @param {object} facts.env      flags for optional providers
 */
export function buildCapabilities(facts = {}) {
  const bts = facts.bts || {
    sites: 0,
    cells: 0,
    source: 'none',
    synthetic: true,
  };
  const cctv = facts.cctv || { total: 0, papua: 0, byType: {} };
  const targets = facts.targets || { count: 0 };
  const news = facts.news || null;
  const vision = facts.vision || { areas: 0 };
  const terrain = facts.terrain || { known: false };
  const env = facts.env || {};

  const btsReal = Boolean(bts.sites) && !bts.synthetic;
  const hasCells = Number(bts.cells) > 0;

  const rows = [
    {
      id: 'bts-registry',
      name: 'BTS registry',
      status: btsReal ? 'real' : 'catalog',
      detail: `${bts.sites} sites · ${bts.cells} cells`,
      source: bts.source,
      license: BTS_LICENSE,
      accuracy:
        'planning radius 1–35 km per cell; terrain-aware per site with ?viewshed=1',
      needs: btsReal ? null : 'run `npm run bts:sweep` with OPENCELLID_API_KEY',
    },
    {
      id: 'cell-locate',
      name: 'Cell ID → position',
      status: hasCells ? 'real' : 'estimate',
      detail: hasCells
        ? 'the cell the handset reported is looked up in the registry'
        : 'no cell ids yet: falls back to a carrier-region estimate',
      source: hasCells ? 'bts-registry' : 'carrier-region heuristic',
      accuracy: hasCells
        ? 'bounded by the serving cell radius'
        : '±20 km (regional guess)',
      needs: 'a cell id from the device: mcc-mnc-lac-cellid',
    },
    {
      id: 'trilateration',
      name: 'Multi-cell trilateration',
      status: 'real',
      detail:
        'weighted centroid, weight = 1 / cell radius, 95 % confidence ellipse',
      source: 'bts-registry',
      accuracy:
        'spread / √n — 100–500 m when three cells are in town; the ellipse says how well they pin it down',
      needs: 'two or more cells the registry knows',
    },
    {
      id: 'coverage',
      name: 'Province coverage',
      status: 'estimate',
      detail:
        '6 provinces, 2 km raster, share of the box inside a planning radius',
      source: 'bts-registry + province boxes',
      accuracy: 'planning radius only; includes sea and empty terrain',
      needs: null,
    },
    {
      id: 'terrain',
      name: 'Terrain elevation',
      status: terrain.known ? 'real' : 'estimate',
      detail: terrain.known
        ? 'Terrarium DEM, zoom 11 (~38 m), keyless, tiles cached on disk'
        : 'DEM unreachable: propagation falls back to the planning radius',
      source: terrain.known ? 'AWS Terrain Tiles (Terrarium)' : null,
      license: terrain.known ? 'public domain (SRTM-derived)' : null,
      accuracy: terrain.known
        ? '±10 m vertical; sampling, not a survey'
        : 'none — flat earth assumed',
      needs: terrain.known
        ? null
        : 'network access to elevation-tiles-prod.s3.amazonaws.com',
    },
    {
      id: 'viewshed',
      name: 'Terrain propagation',
      status: terrain.known ? 'real' : 'estimate',
      detail: terrain.known
        ? '24 radials, knife-edge diffraction over the real terrain profile'
        : 'flat-earth planning radius only',
      source: terrain.known
        ? 'Terrarium DEM + ITU-R style knife-edge model'
        : 'planning radius',
      accuracy: terrain.known
        ? 'a ridge that blocks the path is reported as a shorter range'
        : 'terrain ignored; a mountain does not shorten the range',
      needs: null,
    },
    {
      id: 'terrain-coverage',
      name: 'Terrain-aware coverage',
      status: 'real',
      detail:
        'viewsheds over the whole registry, rasterised per province, with a flat-earth control at the same caps',
      source: 'Terrarium DEM + propagation model (npm run bts:coverage)',
      accuracy:
        'the control is the same sites as circles at the same caps — the delta is terrain, nothing else',
      needs: 'run `npm run bts:coverage` once (resumable)',
    },
    {
      id: 'cell-radio',
      name: 'Cell radio generation',
      status: btsReal ? 'real' : 'estimate',
      detail: btsReal
        ? 'per-site 2G/3G/4G from the registry; per-cell radio from the provider when keyed'
        : 'no registry yet: the radio is guessed from the carrier region',
      source: btsReal ? 'bts-registry (+ OpenCellID radio field when live)' : null,
      accuracy: 'the generation the cell serves — not its frequency',
      needs: null,
    },
    {
      id: 'band-frequency',
      name: 'Band frequency (MHz)',
      status: 'estimate',
      detail:
        'the technology profile\'s planning frequency; the exact EARFCN/UARFCN is not published per cell',
      source: 'TECH_PROFILES planning table',
      accuracy:
        'a representative MHz per generation (e.g. 4G ≈ 1800), never a measured channel',
      needs:
        'an operator feed or a drive test (SDR) for the real channel a handset uses',
    },
    {
      id: 'imei-detect',
      name: 'IMEI detection',
      status: 'blocked',
      detail:
        'an IMEI exists only in the handset and the operator\'s HLR/EIR — nothing on the air or in any public API reveals it',
      source: null,
      accuracy: 'none — any tool claiming this from a phone number is a scam',
      needs:
        'physical access to the device, or a lawful operator/EIR request; this console will not fake it',
    },
    {
      id: 'device-brand',
      name: 'Device brand / model',
      status: 'blocked',
      detail:
        'the IMEI\'s first 8 digits (TAC) name the model — but reading them needs the IMEI, which is blocked',
      source: null,
      accuracy: 'none — without the IMEI there is nothing to look up',
      needs: 'the IMEI (see imei-detect), then a TAC database such as the GSMA TAC',
    },
    {
      id: 'phone-owner',
      name: 'Number → owner',
      status: 'blocked',
      detail:
        'the subscriber record lives in the operator\'s HLR under lawful process only',
      source: null,
      accuracy: 'none',
      needs:
        'a court order or lawful request to the carrier; no API, keyless or paid, returns an owner',
    },
    {
      id: 'target-history',
      name: 'Track history',
      status: 'real',
      detail: 'every fix this console took, one track per carrier',
      source: 'local file (src/data/place-card-results/target-history.json)',
      accuracy: 'as good as the fixes it stores',
      needs: null,
    },
    {
      id: 'phone-locate',
      name: 'Phone number → position',
      status: 'catalog',
      detail: `${targets.count} sample entries; a number alone is not a position`,
      source: 'local catalogue (papua-targets.json)',
      accuracy: 'none — the coordinates are sample data',
      needs:
        'the cell id the handset reports, or a lawful carrier/HLR feed; no public API geolocates a number',
    },
    {
      id: 'handle-locate',
      name: 'Account handle → position',
      status: 'catalog',
      detail: 'same sample catalogue, matched by @handle',
      source: 'local catalogue',
      accuracy: 'none — sample data',
      needs: 'a platform API that reports a location, with consent',
    },
    {
      id: 'cctv',
      name: 'CCTV catalogue',
      status: 'catalog',
      detail: `${cctv.total} entries, ${cctv.papua} in Papua`,
      source: 'local catalogue',
      accuracy: 'camera coordinates are catalogued, the feeds are not live',
      needs: 'a live stream per camera and the right to view it',
    },
    {
      id: 'vision',
      name: 'Image analysis',
      status: 'real',
      detail: `${vision.areas} reference areas; bbox + labels from a vision model`,
      source: env.visionModel
        ? `model ${env.visionModel}`
        : 'local Ollama or OpenAI-compatible endpoint',
      accuracy:
        'model-dependent; boxes are pixel-accurate, labels are not certain',
      needs: env.visionModel
        ? null
        : 'a running model (Ollama qwen2.5vl, or a gateway)',
    },
    {
      id: 'news',
      name: 'Local news',
      status: news ? 'artifact' : 'blocked',
      detail: news
        ? `${news.total} items, ${news.papua} Papua`
        : 'no news artifact yet',
      source: 'collected artifact (indonesia-news.json)',
      accuracy: 'headlines as published; not verified',
      needs: news ? null : 'run the news collector',
    },
    {
      id: 'street-photo',
      name: 'Street-level photo',
      status: 'real',
      detail: 'KartaView, keyless',
      source: 'KartaView',
      license: 'CC BY-SA 4.0 (contributors)',
      accuracy: 'photo geolocation, not live',
      needs: null,
    },
    {
      id: 'ais',
      name: 'Ships (AIS)',
      status: 'blocked',
      detail: 'module exists, no feed',
      source: null,
      accuracy: null,
      needs: 'AISSTREAM_API_KEY',
    },
    {
      id: 'firms',
      name: 'Thermal anomalies (FIRMS)',
      status: 'blocked',
      detail: 'module exists, no feed',
      source: null,
      accuracy: null,
      needs: 'FIRMS_MAP_KEY',
    },
    {
      id: 'offline',
      name: 'Offline shell',
      status: 'real',
      detail: 'service worker, network-first for data',
      source: 'public/sw.js',
      accuracy: null,
      needs: null,
    },
  ];

  const summary = rows.reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    },
    { real: 0, estimate: 0, catalog: 0, artifact: 0, blocked: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    summary,
    rows,
    // The one sentence a buyer or a reviewer needs before reading the table.
    disclaimer:
      'Only "real" rows describe the world. "catalog" rows are a curated sample ' +
      'and must not be presented as tracking. A phone number cannot be geolocated ' +
      'without the network that serves it.',
  };
}
