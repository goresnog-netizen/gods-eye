/**
 * BTS layer model — how much of the registry the globe should show.
 *
 * A map that draws 1,901 towers at every zoom is unreadable, and a map that
 * draws none of them is useless. Human vision solves this with a fovea: full
 * detail at the point of attention, context around it, nothing beyond. This
 * module is that policy, as pure functions so it can be tested without a
 * globe.
 *
 * The three tiers:
 *
 *   province — the camera is far: only the province summary matters
 *   sites    — medium distance: the towers themselves, nearest first
 *   cells    — close: every site plus the cells it serves, and its range
 *
 * The selection is *nearest first*, never arbitrary: an operator who has
 * zoomed to Wamena sees Wamena's towers, not the 1,900 that happen to be
 * first in the file.
 */

/** Altitude (metres above the ellipsoid) at which each tier begins. */
export const TIER_ALTITUDES = Object.freeze({
  cells: 50_000,
  sites: 500_000,
});

/** How many entities each tier may draw, so a zoom cannot melt the GPU. */
export const TIER_LIMITS = Object.freeze({
  cells: 400,
  sites: 250,
  province: 0,
});

/** How far from the camera's focus each tier still draws. */
export const TIER_RADIUS_KM = Object.freeze({
  cells: 60,
  sites: 400,
  province: 0,
});

/**
 * Which tier the camera's altitude calls for.
 *
 * The boundaries are where a tower's own radius stops being resolvable: past
 * 50 km the difference between a 5 km cell and a 35 km cell is a pixel, so
 * cells stop being worth drawing.
 */
export function densityTier(altitudeM) {
  if (!Number.isFinite(altitudeM) || altitudeM < 0) return 'cells';
  if (altitudeM <= TIER_ALTITUDES.cells) return 'cells';
  if (altitudeM <= TIER_ALTITUDES.sites) return 'sites';
  return 'province';
}

/**
 * The sites worth drawing, nearest to the camera's focus first.
 *
 * A site is a candidate only when it is inside the tier's radius *and* inside
 * its entity budget. The budget is filled by distance, so what gets dropped is
 * always the least relevant rather than the last in the file.
 */
export function selectVisibleSites(sites, focus, tier) {
  const radiusKm = TIER_RADIUS_KM[tier] ?? 0;
  const limit = TIER_LIMITS[tier] ?? 0;
  if (!radiusKm || !limit || !focus || !Array.isArray(sites)) return [];

  const candidates = [];
  for (const site of sites) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    // A local name that shadowed the helper would be a TDZ error at runtime;
    // the distance is the sort key, so it keeps its own name.
    const km = distanceKm(focus.lat, focus.lon, site.lat, site.lon);
    if (km > radiusKm) continue;
    candidates.push({ site, distanceKm: km });
  }
  candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  return candidates
    .slice(0, limit)
    .map((entry) => ({ ...entry.site, distanceKm: entry.distanceKm }));
}

/**
 * What the layer reports about itself at this altitude.
 *
 * The status line is not decoration: "1.901 towers · 412 shown · 60 km" tells
 * the operator that the globe is filtered, so an empty-looking region reads as
 * "zoomed out" rather than "no towers here".
 */
export function layerStatus({ total, shown, tier, altitudeM }) {
  if (tier === 'province') {
    return {
      tier,
      shown: 0,
      note: 'Zoom in to see towers',
      altitudeM: Number.isFinite(altitudeM) ? Math.round(altitudeM) : null,
    };
  }
  return {
    tier,
    shown,
    total,
    radiusKm: TIER_RADIUS_KM[tier],
    note:
      shown < total
        ? `${total} towers · ${shown} within ${TIER_RADIUS_KM[tier]} km`
        : `${total} towers shown`,
    altitudeM: Number.isFinite(altitudeM) ? Math.round(altitudeM) : null,
  };
}

/** Great-circle distance in kilometres (haversine, good enough for a filter). */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * A colour for a site's technology, matching the panel's own vocabulary.
 *
 * 4G is the dense, modern network; 2G is the legacy fallback. The colours are
 * the same ones the coverage table uses, so a globe reading and a panel
 * reading agree.
 */
export const TECH_COLORS = Object.freeze({
  '2G': '#8b949e',
  '3G': '#58a6ff',
  '4G': '#3fb950',
  '5G': '#d2a8ff',
  unknown: '#6e7681',
});

export function techColor(tech) {
  return TECH_COLORS[String(tech || '').toUpperCase()] || TECH_COLORS.unknown;
}

/**
 * Turn a registry payload into the flat site list the layer draws.
 *
 * The payload is the same one the panel uses, so the globe and the panel can
 * never disagree about how many towers exist.
 */
export function sitesFromPayload(payload) {
  const sites = Array.isArray(payload?.sites) ? payload.sites : [];
  return sites
    .filter((site) => Number.isFinite(site?.lat) && Number.isFinite(site?.lon))
    .map((site) => ({
      id: site.id,
      name: site.name || site.id,
      lat: site.lat,
      lon: site.lon,
      tech: site.tech || 'unknown',
      rangeKm: Number.isFinite(site.rangeKm) ? site.rangeKm : null,
      cells: Array.isArray(site.cells) ? site.cells.length : 0,
      samples: Number.isFinite(site.samples) ? site.samples : 0,
    }));
}
