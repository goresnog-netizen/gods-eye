/**
 * BTS registry — the cell sites a position can be compared against.
 *
 * The question this answers is "is this point near a tower or far from one",
 * which is geometry over a list of sites. It is only as precise as the list:
 * the seed below is a SYNTHETIC set of Papua sites placed at the regency
 * centres this console already watches, marked `synthetic: true` so nothing
 * downstream can mistake it for operator data.
 *
 * Importing a real registry (OpenCellID dump, an operator export, a field
 * survey) replaces the seed through the same JSON shape — no code change.
 */

const SITE = (id, name, lat, lon, tech, rangeKm) => ({
  id,
  name,
  lat,
  lon,
  tech,
  rangeKm,
  cells: [],
  source: 'local-seed',
  synthetic: true,
});

/**
 * A synthetic site list: every regency capital this console watches, plus a
 * second site in the larger towns so a nearest-tower query has a choice.
 * `rangeKm` is the planning radius of the technology, not a measurement.
 */
export const BTS_SEED = Object.freeze([
  SITE('bts-jyp-01', 'Jayapura Kota', -2.5337, 140.7175, '4G', 5),
  SITE('bts-jyp-02', 'Sentani', -2.576, 140.514, '4G', 5),
  SITE('bts-jyp-03', 'Waena', -2.59, 140.64, '3G', 10),
  SITE('bts-tim-01', 'Timika Kota', -4.5461, 136.8876, '4G', 5),
  SITE('bts-tim-02', 'Kuala Kencana', -4.4, 136.87, '4G', 5),
  SITE('bts-mrk-01', 'Merauke Kota', -8.4932, 140.4018, '4G', 5),
  SITE('bts-mrk-02', 'Tanah Miring', -8.35, 140.5, '3G', 10),
  SITE('bts-nab-01', 'Nabire Kota', -3.3667, 135.4833, '4G', 5),
  SITE('bts-nab-02', 'Siriwini', -3.4, 135.5, '3G', 10),
  SITE('bts-bik-01', 'Biak Kota', -1.1833, 136.0833, '4G', 5),
  SITE('bts-bik-02', 'Bosnik', -1.15, 136.2, '3G', 10),
  SITE('bts-sor-01', 'Sorong Kota', -0.8763, 131.2558, '4G', 5),
  SITE('bts-sor-02', 'Aimas', -0.95, 131.35, '3G', 10),
  SITE('bts-mnk-01', 'Manokwari Kota', -0.8615, 134.062, '4G', 5),
  SITE('bts-mnk-02', 'Ransiki', -1.5, 134.15, '2G', 35),
  SITE('bts-wmn-01', 'Wamena Kota', -4.1, 138.95, '4G', 5),
  SITE('bts-wmn-02', 'Napua', -4.05, 138.9, '3G', 10),
  SITE('bts-pja-01', 'Mulia (Puncak Jaya)', -3.6167, 137.4833, '3G', 10),
  SITE('bts-tlk-01', 'Karubaga (Tolikara)', -3.6833, 138.4833, '2G', 35),
  SITE('bts-yhk-01', 'Dekai (Yahukimo)', -4.4833, 139.5333, '2G', 35),
  SITE('bts-fkf-01', 'Fakfak', -2.9167, 132.3, '3G', 10),
  SITE('bts-kmn-01', 'Kaimana', -3.65, 133.75, '3G', 10),
  SITE('bts-srm-01', 'Sarmi', -1.8667, 138.75, '2G', 35),
  SITE('bts-krm-01', 'Waris (Keerom)', -3.4, 140.9, '2G', 35),
  SITE('bts-bdg-01', 'Tanah Merah (Boven Digoel)', -6.1, 140.3, '3G', 10),
  SITE('bts-asm-01', 'Agats (Asmat)', -5.55, 138.1, '2G', 35),
  SITE('bts-mpi-01', 'Kepi (Mappi)', -6.5, 139.3, '2G', 35),
  SITE('bts-dgy-01', 'Dogiyai', -4.0, 135.8, '3G', 10),
  SITE('bts-ijy-01', 'Sugapa (Intan Jaya)', -3.75, 137.1, '2G', 35),
  SITE('bts-ljy-01', 'Tiom (Lanny Jaya)', -3.95, 138.4, '2G', 35),
  SITE('bts-mbt-01', 'Kobakma (Mamberamo Tengah)', -3.6, 139.0, '2G', 35),
  SITE('bts-dyi-01', 'Tigi (Deiyai)', -4.05, 136.3, '2G', 35),
  SITE('bts-pni-01', 'Enarotali (Paniai)', -3.9167, 136.3667, '3G', 10),
  SITE('bts-wnd-01', 'Rasiei (Teluk Wondama)', -2.7, 134.5, '2G', 35),
  SITE('bts-myb-01', 'Kumurkek (Maybrat)', -1.25, 132.5, '2G', 35),
  SITE('bts-tmb-01', 'Fef (Tambrauw)', -0.8, 132.4, '2G', 35),
  SITE('bts-rja-01', 'Waisai (Raja Ampat)', -0.4333, 130.8167, '3G', 10),
  SITE('bts-sup-01', 'Supiori', -0.7, 135.6, '2G', 35),
  SITE('bts-wrp-01', 'Botawa (Waropen)', -2.1, 136.6, '2G', 35),
  SITE('bts-ypn-01', 'Serui (Yapen)', -1.8833, 136.2333, '3G', 10),
  SITE('bts-ndg-01', 'Kenyam (Nduga)', -4.45, 138.0, '2G', 35),
  SITE('bts-pgb-01', 'Oksibil (Pegunungan Bintang)', -4.9, 140.6, '2G', 35),
]);

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from one point to another, in degrees. */
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Every site with its distance, bearing and how much of its range the point
 * consumes. Sorted nearest first.
 *
 * `coveragePct` is the honest way to say "near or far": 30% of a 5 km cell is
 * a different claim from 30% of a 35 km cell, and the number carries both.
 */
export function nearestTowers(
  registry,
  lat,
  lon,
  { limit = 5, radiusKm = null } = {},
) {
  const found = [];
  for (const site of registry || []) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    const distance = distanceKm(lat, lon, site.lat, site.lon);
    if (radiusKm !== null && distance > radiusKm) continue;
    found.push({
      id: site.id,
      name: site.name,
      lat: site.lat,
      lon: site.lon,
      tech: site.tech,
      rangeKm: site.rangeKm,
      source: site.source || null,
      synthetic: Boolean(site.synthetic),
      distanceKm: Math.round(distance * 100) / 100,
      bearing: Math.round(bearing(lat, lon, site.lat, site.lon)),
      coveragePct: site.rangeKm
        ? Math.round((distance / site.rangeKm) * 100)
        : null,
    });
  }
  found.sort((a, b) => a.distanceKm - b.distanceKm);
  return found.slice(0, Math.max(1, limit));
}

/**
 * The nearest site and what it implies about the point.
 *
 * `inCoverage` says the point is inside the planning radius; `class` says how
 * far into it, so a reader does not have to interpret a percentage.
 */
export function describePoint(registry, lat, lon, { limit = 5 } = {}) {
  const towers = nearestTowers(registry, lat, lon, { limit });
  const nearest = towers[0] || null;
  if (!nearest) {
    return { towers: [], nearest: null, inCoverage: null, class: 'unknown' };
  }
  const pct = nearest.coveragePct;
  const klass =
    pct === null
      ? 'unknown'
      : pct <= 50
        ? 'near'
        : pct <= 100
          ? 'mid'
          : pct <= 150
            ? 'edge'
            : 'far';
  return {
    towers,
    nearest,
    inCoverage: pct !== null ? pct <= 100 : null,
    class: klass,
  };
}

/**
 * Sites that carry one of the given cells.
 *
 * A registry entry may list the LAC/cell pairs it serves. The seed lists none,
 * so this answers "unknown" until a real registry is imported — which is the
 * truthful answer, not a guess dressed as a tower.
 */
export function findCells(registry, cells = []) {
  const wanted = cells.filter((cell) => cell && Number.isFinite(cell.cellId));
  const matches = [];
  for (const site of registry || []) {
    for (const served of site.cells || []) {
      const hit = wanted.find(
        (cell) =>
          Number(cell.cellId) === Number(served.cellId) &&
          (cell.lac === undefined || Number(cell.lac) === Number(served.lac)),
      );
      if (hit) matches.push({ site, cell: hit });
    }
  }
  return matches;
}

/**
 * A position from several known sites, weighted by how much of each range the
 * target is expected to sit at.
 *
 * This is the trilateration step: one tower gives a circle, three give a point.
 * It is exported and tested now because it is the only method that improves
 * precision without a provider — it needs a registry that knows cell ids.
 */
export function trilaterate(observations = []) {
  const usable = observations.filter(
    (entry) =>
      Number.isFinite(entry?.lat) &&
      Number.isFinite(entry?.lon) &&
      Number.isFinite(entry?.weight) &&
      entry.weight > 0,
  );
  if (usable.length < 2) {
    return {
      ok: false,
      reason: 'at least two known sites are required',
      samples: usable.length,
    };
  }
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  const lat =
    usable.reduce((sum, entry) => sum + entry.lat * entry.weight, 0) /
    totalWeight;
  const lon =
    usable.reduce((sum, entry) => sum + entry.lon * entry.weight, 0) /
    totalWeight;
  const spreadKm =
    usable.reduce(
      (sum, entry) =>
        sum + distanceKm(lat, lon, entry.lat, entry.lon) * entry.weight,
      0,
    ) / totalWeight;

  // A single point hides how sure the answer is. The weighted covariance says
  // whether the observations pin the target down (a tight circle) or only
  // along one line (a long ellipse) — which is what three towers in a row
  // actually give you.
  const metresPerDegLat = 110_540;
  const metresPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const entry of usable) {
    const dx = (entry.lon - lon) * metresPerDegLon;
    const dy = (entry.lat - lat) * metresPerDegLat;
    sxx += entry.weight * dx * dx;
    syy += entry.weight * dy * dy;
    sxy += entry.weight * dx * dy;
  }
  sxx /= totalWeight;
  syy /= totalWeight;
  sxy /= totalWeight;
  // Eigenvalues of a symmetric 2×2 give the axes; 2σ is the 95 % ellipse.
  const trace = sxx + syy;
  const diff = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  const major = Math.sqrt(Math.max(0, trace / 2 + diff));
  const minor = Math.sqrt(Math.max(0, trace / 2 - diff));
  const azimuth = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;

  return {
    ok: true,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    samples: usable.length,
    spreadKm: Math.round(spreadKm * 100) / 100,
    // The best case is one site's own accuracy divided by the number of
    // independent observations; this is an estimate, not a guarantee.
    accuracyM: Math.round(
      Math.max(100, (spreadKm * 1000) / Math.sqrt(usable.length)),
    ),
    ellipse: {
      semiMajorM: Math.round(major * 2),
      semiMinorM: Math.round(minor * 2),
      azimuthDeg: Math.round(((azimuth % 180) + 180) % 180),
    },
  };
}
