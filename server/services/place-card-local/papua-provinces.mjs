/**
 * The six provinces of Papua, and what a BTS registry actually covers in them.
 *
 * Why a module and not a bounding box: "Papua" stopped being one box in 2022.
 * A coverage answer that treats the island as a single rectangle cannot say
 * *where* the network ends, which is the only useful part of the answer.
 *
 * The provinces are described by their approximate extent, not by a surveyed
 * polygon. That is enough to place a coordinate in a province and to sample
 * coverage, and it is stated here rather than implied: every number this
 * module returns is over a grid of the province's box, sea included, so it is
 * a *coverage of the box*, not a population-weighted coverage.
 */

/** Great-circle distance in kilometres. */
const R_KM = 6371;
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ordered by specificity: the first box that contains a point wins, so the
 * smaller provinces are tested before the large ones. The order is
 * load-bearing in both directions —
 *   Nabire (-3.37, 135.48) sits inside Papua's box but is the capital of
 *   Papua Tengah, so Tengah is tested first;
 *   Waris (-3.40) belongs to Papua while Karubaga (-3.68) belongs to Papua
 *   Pegunungan, which is why Papua's southern edge stops at -3.5.
 */
export const PAPUA_PROVINCES = Object.freeze([
  {
    id: 'papua-barat-daya',
    name: 'Papua Barat Daya',
    capital: 'Sorong',
    capitalLat: -0.8763,
    capitalLon: 131.2558,
    bbox: { south: -1.9, west: 129.9, north: 0.2, east: 133.2 },
    areaKm2: 39167,
  },
  {
    id: 'papua-barat',
    name: 'Papua Barat',
    capital: 'Manokwari',
    capitalLat: -0.8615,
    capitalLon: 134.062,
    bbox: { south: -4.1, west: 131.8, north: -0.5, east: 134.9 },
    areaKm2: 60275,
  },
  {
    id: 'papua-tengah',
    name: 'Papua Tengah',
    capital: 'Nabire',
    capitalLat: -3.3667,
    capitalLon: 135.4833,
    bbox: { south: -5.2, west: 134.4, north: -2.9, east: 137.6 },
    areaKm2: 61073,
  },
  {
    id: 'papua',
    name: 'Papua',
    capital: 'Jayapura',
    capitalLat: -2.5337,
    capitalLon: 140.7175,
    bbox: { south: -3.5, west: 135.3, north: -0.4, east: 141.3 },
    areaKm2: 82681,
  },
  {
    id: 'papua-pegunungan',
    name: 'Papua Pegunungan',
    capital: 'Wamena',
    capitalLat: -4.1,
    capitalLon: 138.95,
    bbox: { south: -5.3, west: 137.3, north: -3.3, east: 141.0 },
    areaKm2: 108476,
  },
  {
    id: 'papua-selatan',
    name: 'Papua Selatan',
    capital: 'Merauke',
    capitalLat: -8.4932,
    capitalLon: 140.4018,
    bbox: { south: -9.6, west: 137.4, north: -4.95, east: 141.6 },
    areaKm2: 117849,
  },
]);

/** The whole island's extent — the union of the six boxes. */
export const PAPUA_BOUNDS = Object.freeze({
  south: -9.6,
  west: 129.9,
  north: 0.2,
  east: 141.6,
});

export const PROVINCE_IDS = Object.freeze(
  PAPUA_PROVINCES.map((province) => province.id),
);

function inBox(lat, lon, box) {
  return (
    lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east
  );
}

/** The province a coordinate falls in, or null when it is outside Papua. */
export function provinceOf(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const province of PAPUA_PROVINCES) {
    if (inBox(lat, lon, province.bbox)) return province;
  }
  return null;
}

/** Look one province up by id (or by its display name, case-insensitive). */
export function findProvince(idOrName) {
  const needle = String(idOrName || '')
    .trim()
    .toLowerCase();
  if (!needle) return null;
  return (
    PAPUA_PROVINCES.find((province) => province.id === needle) ||
    PAPUA_PROVINCES.find(
      (province) => province.name.toLowerCase() === needle,
    ) ||
    null
  );
}

/**
 * Sites bucketed into a coarse grid so a nearest-site question does not scan
 * the whole registry. A 0.5° bucket is ~55 km, wider than any planning radius
 * in the registry, so ring 0 already answers "covered" when it can.
 */
export function buildSiteIndex(sites = [], cellDeg = 0.5) {
  const buckets = new Map();
  const keyOf = (lat, lon) =>
    `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;
  for (const site of sites) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    const key = keyOf(site.lat, site.lon);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(site);
  }
  return { buckets, cellDeg, keyOf, size: sites.length };
}

/**
 * The closest site to a point, searching outward one bucket at a time.
 *
 * The search stops as soon as the next ring cannot beat the best distance
 * found, so an isolated point does not pay for the whole registry. `maxRing`
 * bounds the work: beyond that the answer is "no site within reach", which is
 * a fact about coverage rather than a failure.
 */
export function nearestSite(index, lat, lon, { maxRing = 4 } = {}) {
  if (!index || !index.buckets?.size) return null;
  const { cellDeg } = index;
  const gx = Math.floor(lat / cellDeg);
  const gy = Math.floor(lon / cellDeg);
  let best = null;
  for (let ring = 0; ring <= maxRing; ring += 1) {
    // Every point in this ring is at least this far from the query.
    const floorKm = Math.max(0, ring - 1) * cellDeg * 111;
    if (best && floorKm > best.distanceKm) break;
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const bucket = index.buckets.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const site of bucket) {
          const distance = distanceKm(lat, lon, site.lat, site.lon);
          if (!best || distance < best.distanceKm) {
            best = { site, distanceKm: distance };
          }
        }
      }
    }
  }
  return best;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * fraction)),
  );
  return sorted[index];
}

/**
 * The cells of a fine grid that sit inside some site's radius.
 *
 * Coverage is an *area* question, so it is answered by marking area: each site
 * paints the cells of a ~2.2 km grid that fall within its planning radius.
 * Sampling a coarse grid instead — the first version — reports ~0 % whenever
 * the grid is wider than the radius, which for a 5 km cell on a 22 km grid is
 * always. This is O(sites × cells per radius), not O(points × sites).
 */
function paintCoverage(sites, cellDeg) {
  const painted = new Set();
  const keyOf = (latIdx, lonIdx) => `${latIdx}:${lonIdx}`;
  for (const site of sites) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    const rangeKm = Number(site.rangeKm);
    if (!Number.isFinite(rangeKm) || rangeKm <= 0) continue;
    const dLat = rangeKm / 111.32;
    const dLon =
      rangeKm / (111.32 * Math.max(0.05, Math.cos((site.lat * Math.PI) / 180)));
    const south = Math.floor((site.lat - dLat) / cellDeg);
    const north = Math.ceil((site.lat + dLat) / cellDeg);
    const west = Math.floor((site.lon - dLon) / cellDeg);
    const east = Math.ceil((site.lon + dLon) / cellDeg);
    for (let i = south; i <= north; i += 1) {
      for (let j = west; j <= east; j += 1) {
        const key = keyOf(i, j);
        if (painted.has(key)) continue;
        const lat = (i + 0.5) * cellDeg;
        const lon = (j + 0.5) * cellDeg;
        if (distanceKm(site.lat, site.lon, lat, lon) <= rangeKm)
          painted.add(key);
      }
    }
  }
  return painted;
}

/**
 * How much of a province's box a registry covers.
 *
 * Two different questions, two different methods:
 *   - **coverage** is area, so it is rasterised at `cellDeg` (≈2.2 km) and the
 *     answer is the share of the province's cells inside some radius;
 *   - **median distance** is a sample, so it is taken on `gridDeg` (≈22 km) and
 *     reported with p90 — "the median point of Papua is 84 km from a known
 *     cell" is a sentence an operator can act on.
 *
 * The boxes include sea, so the percentage is of the box, not of the land and
 * certainly not of the population.
 */
export function provinceCoverage(
  sites = [],
  { gridDeg = 0.2, cellDeg = 0.02, index = null, maxRing = 3 } = {},
) {
  const siteIndex = index || buildSiteIndex(sites);
  const painted = paintCoverage(sites, cellDeg);
  const rows = [];
  for (const province of PAPUA_PROVINCES) {
    const own = sites.filter(
      (site) => provinceOf(site.lat, site.lon)?.id === province.id,
    );
    const byTech = {};
    let cells = 0;
    for (const site of own) {
      const tech = site.tech || 'unknown';
      byTech[tech] = (byTech[tech] || 0) + 1;
      cells += Array.isArray(site.cells) ? site.cells.length : 0;
    }

    // Area: count the province's own grid cells, and how many are painted.
    let areaCells = 0;
    let coveredCells = 0;
    const south = Math.floor(province.bbox.south / cellDeg);
    const north = Math.ceil(province.bbox.north / cellDeg);
    const west = Math.floor(province.bbox.west / cellDeg);
    const east = Math.ceil(province.bbox.east / cellDeg);
    for (let i = south; i <= north; i += 1) {
      for (let j = west; j <= east; j += 1) {
        areaCells += 1;
        if (painted.has(`${i}:${j}`)) coveredCells += 1;
      }
    }

    // Distance: a coarse sample, enough for a median and a p90.
    const nearestDistances = [];
    for (
      let lat = province.bbox.south;
      lat <= province.bbox.north;
      lat += gridDeg
    ) {
      for (
        let lon = province.bbox.west;
        lon <= province.bbox.east;
        lon += gridDeg
      ) {
        const found = nearestSite(siteIndex, lat, lon, { maxRing });
        if (found) nearestDistances.push(found.distanceKm);
      }
    }

    rows.push({
      id: province.id,
      name: province.name,
      capital: province.capital,
      capitalLat: province.capitalLat,
      capitalLon: province.capitalLon,
      areaKm2: province.areaKm2,
      sites: own.length,
      cells,
      byTech,
      samplePoints: areaCells,
      coveredPoints: coveredCells,
      // Two decimals: 0,02 % is a real answer for one site in a province,
      // and rounding it to 0,0 % would erase it.
      coveredPct: areaCells
        ? Math.round((coveredCells / areaCells) * 10000) / 100
        : null,
      medianNearestKm: nearestDistances.length
        ? Math.round(percentile(nearestDistances, 0.5) * 10) / 10
        : null,
      p90NearestKm: nearestDistances.length
        ? Math.round(percentile(nearestDistances, 0.9) * 10) / 10
        : null,
      basis: 'province-bbox-raster',
      cellDeg,
      gridDeg,
    });
  }

  const totalPoints = rows.reduce((sum, row) => sum + row.samplePoints, 0);
  const totalCovered = rows.reduce((sum, row) => sum + row.coveredPoints, 0);
  return {
    provinces: rows,
    totals: {
      sites: rows.reduce((sum, row) => sum + row.sites, 0),
      cells: rows.reduce((sum, row) => sum + row.cells, 0),
      samplePoints: totalPoints,
      coveredPoints: totalCovered,
      coveredPct: totalPoints
        ? Math.round((totalCovered / totalPoints) * 10000) / 100
        : null,
      cellDeg,
      gridDeg,
    },
  };
}

/** Sites that fall inside one province, for a filtered listing. */
export function sitesInProvince(sites = [], provinceId) {
  const province = findProvince(provinceId);
  if (!province) return [];
  return sites.filter(
    (site) => provinceOf(site.lat, site.lon)?.id === province.id,
  );
}
