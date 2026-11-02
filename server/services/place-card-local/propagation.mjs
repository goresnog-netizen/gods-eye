/**
 * How far a cell actually reaches, over the ground it actually has.
 *
 * A planning radius is a circle and terrain is not. This module walks a radial
 * out from the antenna, samples the ground, and stops where the link stops
 * closing:
 *
 *   budget  — free-space loss against the technology's EIRP and sensitivity,
 *             capped by a planning radius (interference, not physics, is what
 *             really limits a 4G cell, so the cap is honest and stated).
 *             `clutterModel: 'landcover'` spends the flat allowance scaled by
 *             the share of the walk that is actually in scattering cover
 *             (ESA WorldCover 10 m, keyless). `'roughness'` is the older proxy
 *             — the terrain's own grade — kept for comparisons where the
 *             land-cover tile is not cached yet.
 *   terrain — first Fresnel zone clearance, and knife-edge diffraction when a
 *             ridge cuts into it (ITU-R P.526).
 *   antenna — `tiltDeg` turns on a 3GPP-style vertical pattern: a downtilted
 *             beam leaves a hole under the mast and trims the far edge, which
 *             a flat model cannot say. Default 0 keeps the flat behaviour and
 *             avoids double-counting the clutter allowance.
 *
 * The result is a polygon, not a circle: in Papua that is the difference
 * between "5 km" and "9 km up the valley, 1.1 km behind the ridge".
 */

import {
  WORLDCOVER_ATTRIBUTION,
  landCoverClutterDb,
  landCoverStats,
} from './landcover.mjs';

/** Link budgets and caps per technology. Cap = interference-limited planning radius. */
export const TECH_PROFILES = Object.freeze({
  '2G': {
    freqMhz: 900,
    eirpDbm: 55,
    sensitivityDbm: -104,
    clutterDb: 6,
    capKm: 60,
  },
  '3G': {
    freqMhz: 2100,
    eirpDbm: 58,
    sensitivityDbm: -110,
    clutterDb: 8,
    capKm: 30,
  },
  '4G': {
    freqMhz: 1800,
    eirpDbm: 58,
    sensitivityDbm: -110,
    clutterDb: 8,
    capKm: 20,
  },
  '5G': {
    freqMhz: 3500,
    eirpDbm: 58,
    sensitivityDbm: -105,
    clutterDb: 10,
    capKm: 3,
  },
  unknown: {
    freqMhz: 1800,
    eirpDbm: 58,
    sensitivityDbm: -110,
    clutterDb: 8,
    capKm: 20,
  },
});

/** Extra loss a link tolerates before the range is cut (≈ a factor of 4 in power). */
export const DEFAULT_TERRAIN_TOLERANCE_DB = 12;

/** Vertical beamwidth (3 dB points) of a typical sector antenna, in degrees. */
export const DEFAULT_V_BEAM_DEG = 10;

/**
 * Extra clutter loss implied by the terrain's own roughness.
 *
 * This was the stand-in for land cover, on the premise that no keyless global
 * land-cover service existed. That premise is dead: `landcover.mjs` reads ESA
 * WorldCover 10 m and is now the preferred model. Roughness stays because it
 * measures a different thing — broken ground scatters energy even where the
 * cover is open — and because it needs no tiles, so an offline ring still has a
 * defensible answer.
 *
 * The number is the RMS grade of the sampled profile (percent), scaled by
 * `gainDbPerPctGrade` and capped at `maxDb` so it can never dominate the link.
 */
export function terrainClutterDb(
  terrain = [],
  stepKm,
  { gainDbPerPctGrade = 0.25, maxDb = 10 } = {},
) {
  if (!Array.isArray(terrain) || terrain.length < 2 || !(stepKm > 0)) return 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 1; i < terrain.length; i += 1) {
    const gradePct =
      Math.abs((terrain[i] - terrain[i - 1]) / (stepKm * 1000)) * 100;
    sumSq += gradePct * gradePct;
    count += 1;
  }
  const rmsGrade = Math.sqrt(sumSq / count);
  return Math.min(maxDb, Math.round(rmsGrade * gainDbPerPctGrade * 10) / 10);
}

/**
 * Vertical antenna-pattern loss at an angle off boresight (3GPP TR 36.814 form).
 *
 * Returns 0 on boresight, -3 dB at half the vertical beamwidth, -12 dB at the
 * full beamwidth, and -12 dB beyond it. Negative by construction: it is a gain
 * reduction, so callers subtract it from the budget rather than add it to the
 * diffraction loss.
 */
export function verticalPatternLossDb(
  offBoresightDeg,
  v3dbDeg = DEFAULT_V_BEAM_DEG,
) {
  if (!Number.isFinite(offBoresightDeg) || !(v3dbDeg > 0)) return 0;
  const off = Math.abs(offBoresightDeg);
  const lossDb = Math.min(12, 12 * (off / v3dbDeg) ** 2);
  return lossDb > 0 ? -lossDb : 0;
}

const SPEED_OF_LIGHT = 299_792_458;

/** Free-space path loss in dB at a distance in kilometres and a frequency in MHz. */
export function freeSpaceLossDb(distanceKm, freqMhz) {
  if (!(distanceKm > 0)) return 0;
  return 32.44 + 20 * Math.log10(distanceKm) + 20 * Math.log10(freqMhz);
}

/** The distance at which the budget closes, before any cap or terrain. */
export function budgetRangeKm(profile = TECH_PROFILES['4G']) {
  const allowance =
    profile.eirpDbm - profile.sensitivityDbm - profile.clutterDb;
  const exponent = (allowance - 32.44 - 20 * Math.log10(profile.freqMhz)) / 20;
  return 10 ** exponent;
}

/** First Fresnel radius in metres at the obstacle, distances in kilometres. */
export function fresnelRadiusM(d1Km, d2Km, freqMhz) {
  if (!(d1Km > 0) || !(d2Km > 0)) return 0;
  const total = d1Km + d2Km;
  return 17.32 * Math.sqrt((d1Km * d2Km) / ((freqMhz / 1000) * total));
}

/**
 * Knife-edge diffraction loss (ITU-R P.526 §4.1), given the clearance ratio v.
 *
 * `v` is negative when the path clears the obstacle; below -0.78 the loss is
 * zero and the terrain is not in the way at all.
 */
export function knifeEdgeLossDb(v) {
  if (!Number.isFinite(v) || v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
}

/**
 * The diffraction loss of the worst obstacle between two heights.
 *
 * `terrain` is the sampled ground along the path (metres), `d1` the distance
 * from the antenna in kilometres, `total` the whole path length.
 */
export function pathLossDb({
  terrain = [],
  stepKm = 0,
  antennaM,
  receiverM = 1.5,
  freqMhz,
}) {
  if (terrain.length < 2 || !(stepKm > 0)) {
    return { lossDb: 0, worstAtKm: null, clearanceM: null };
  }
  const total = (terrain.length - 1) * stepKm;
  // The receiver stands on the ground at the far end, not at sea level: a line
  // drawn to an absolute 1.5 m dives into the first hill and reports a wall.
  const receiverHeight = terrain[terrain.length - 1] + receiverM;
  let worst = { lossDb: 0, atKm: null, clearanceM: null };
  for (let i = 1; i < terrain.length - 1; i += 1) {
    const d1 = i * stepKm;
    const d2 = total - d1;
    const lineHeight = antennaM + ((receiverHeight - antennaM) * d1) / total;
    const clearance = lineHeight - terrain[i];
    if (clearance > 0) continue;
    const lambda = SPEED_OF_LIGHT / (freqMhz * 1e6);
    const v =
      -clearance *
      Math.sqrt((2 / lambda) * (1 / (d1 * 1000) + 1 / (d2 * 1000)));
    const loss = knifeEdgeLossDb(v);
    if (loss > worst.lossDb)
      worst = { lossDb: loss, atKm: d1, clearanceM: clearance };
  }
  return worst;
}

/** Great-circle destination from a point, for the polygon ring. */
export function destination(lat, lon, bearingDeg, distanceKm) {
  const R = 6371;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const angular = distanceKm / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/**
 * One radial: walk out until the terrain stops the link.
 *
 * `elevationAt(lat, lon)` returns metres or null. A null is treated as sea
 * level: better to over-report a range than to invent a mountain.
 *
 * `clutterModel: 'roughness'` spends part of the budget on the terrain's own
 * roughness (see `terrainClutterDb`); `'flat'` keeps the technology's flat
 * clutter allowance. `tiltDeg` enables the vertical antenna pattern — 0 leaves
 * it off so the flat clutter allowance is not counted twice.
 */
export async function radialRange({
  site,
  azimuthDeg,
  profile = TECH_PROFILES['4G'],
  elevationAt,
  stepM = 300,
  toleranceDb = DEFAULT_TERRAIN_TOLERANCE_DB,
  maxKm = null,
  clutterModel = 'flat',
  landCoverAt = null,
  tiltDeg = 0,
  vBeamDeg = DEFAULT_V_BEAM_DEG,
}) {
  const cap = Math.min(
    profile.capKm,
    maxKm ?? profile.capKm,
    budgetRangeKm(profile),
  );
  const antennaM = (site.groundM ?? 0) + (site.heightM ?? 30);
  const stepKm = stepM / 1000;
  const terrain = [];
  const cover = [];
  let rangeKm = 0;
  let worst = { lossDb: 0, atKm: null };
  let patternWorstDb = 0;
  let marginAtRange = toleranceDb;
  let stopped = false;
  let extraClutterDb = 0;

  for (let d = stepKm; d <= cap + 1e-9; d += stepKm) {
    const point = destination(site.lat, site.lon, azimuthDeg, d);
    const ground = await elevationAt(point.lat, point.lon);
    terrain.push(ground ?? 0);

    // Roughness grows with what the walk has seen, so the penalty is the one
    // the path actually earned — flat into a valley, rough into the mountains.
    if (clutterModel === 'roughness' && terrain.length > 1) {
      extraClutterDb = terrainClutterDb(terrain, stepKm);
    }
    // Land cover answers what a knife edge cannot: flat water and flat canopy
    // have the same profile. The allowance is the technology's own flat figure
    // scaled by the cluttered share of the walk, so it can only ever spend
    // margin the budget already had — never invent a new decibel.
    if (clutterModel === 'landcover' && typeof landCoverAt === 'function') {
      cover.push(await landCoverAt(point.lat, point.lon));
      extraClutterDb = landCoverClutterDb(landCoverStats(cover), {
        flatDb: profile.clutterDb,
      });
    }
    // The receiver stands on the ground at this sample, so the depression angle
    // is measured down to it; the pattern loss is what the beam costs in that
    // direction.
    let patternDb = 0;
    if (tiltDeg) {
      const depressionDeg =
        (Math.atan2(antennaM - (ground ?? 0) - 1.5, d * 1000) * 180) / Math.PI;
      patternDb = verticalPatternLossDb(depressionDeg - tiltDeg, vBeamDeg);
      if (patternDb < patternWorstDb) patternWorstDb = patternDb;
    }
    // Clutter and the beam pattern spend the same fade margin the terrain
    // does. The flat link budgets are hundreds of kilometres — the radius that
    // binds a real cell is interference, not physics — so the margin is the
    // single thing terrain, roughness and the pattern all consume, and a
    // downtilted beam near its mast simply has none left.
    const marginDb = toleranceDb - extraClutterDb + patternDb;
    if (marginDb <= 0) {
      stopped = true;
      break;
    }

    const loss = pathLossDb({
      terrain,
      stepKm,
      antennaM,
      freqMhz: profile.freqMhz,
    });
    if (loss.lossDb > worst.lossDb)
      worst = { lossDb: loss.lossDb, atKm: loss.atKm };
    if (loss.lossDb > marginDb) {
      stopped = true;
      break;
    }
    rangeKm = d;
    marginAtRange = marginDb;
  }

  // Samples land on a grid, so the last one can sit a step short of the cap.
  // When the walk finished without being stopped, every sample to the cap was
  // within tolerance and the cap is the answer — reporting 19.8 km for a clear
  // 20 km would imply terrain that is not there.
  if (!stopped && rangeKm > 0) rangeKm = cap;

  return {
    azimuthDeg,
    rangeKm: Math.round(rangeKm * 100) / 100,
    obstructionDb: Math.round(worst.lossDb * 10) / 10,
    obstructionAtKm:
      worst.atKm === null ? null : Math.round(worst.atKm * 100) / 100,
    clutterDb: extraClutterDb,
    landCover:
      cover.length > 0
        ? (() => {
            const stats = landCoverStats(cover);
            return {
              dominant: stats.dominant,
              cluttered: stats.cluttered,
              samples: stats.total,
              clutteredFraction: Math.round(stats.fraction * 1000) / 1000,
              histogram: stats.histogram,
            };
          })()
        : null,
    patternDb: Math.round(patternWorstDb * 10) / 10,
    marginDb: Math.round(marginAtRange * 10) / 10,
  };
}

/**
 * The whole ring: N radials, a closed polygon, and the terrain it crossed.
 *
 * `azimuths` trades smoothness for time; 24 is a 15° step, which is finer than
 * the terrain features that matter at these ranges.
 *
 * The `profile` block echoes the model that produced the polygon — clutter
 * model, tilt, tolerance — so a reader can tell a flat-earth answer from a
 * terrain-aware one without re-deriving it.
 */
export async function viewshed({
  site,
  profile = TECH_PROFILES['4G'],
  azimuths = 24,
  stepM = 300,
  toleranceDb = DEFAULT_TERRAIN_TOLERANCE_DB,
  elevationAt,
  maxKm = null,
  clutterModel = 'flat',
  landCoverAt = null,
  tiltDeg = 0,
  vBeamDeg = DEFAULT_V_BEAM_DEG,
}) {
  if (typeof elevationAt !== 'function') {
    return { ok: false, error: 'elevation_required' };
  }
  if (clutterModel === 'landcover' && typeof landCoverAt !== 'function') {
    return { ok: false, error: 'landcover_required' };
  }
  const groundM = await elevationAt(site.lat, site.lon);
  const anchor = { ...site, groundM: groundM ?? 0 };
  const rings = [];
  for (let i = 0; i < azimuths; i += 1) {
    const azimuthDeg = Math.round((360 / azimuths) * i);
    try {
      rings.push(
        await radialRange({
          site: anchor,
          azimuthDeg,
          profile,
          elevationAt,
          stepM,
          toleranceDb,
          maxKm,
          clutterModel,
          landCoverAt,
          tiltDeg,
          vBeamDeg,
        }),
      );
    } catch (error) {
      // A land-cover ring without land cover is not a ring with less clutter:
      // it is an unanswered question. Say so instead of returning a polygon
      // built on a model that never ran.
      if (clutterModel === 'landcover') {
        return {
          ok: false,
          error: 'landcover_unavailable',
          detail: String(error?.message || error),
        };
      }
      throw error;
    }
  }
  const polygon = rings.map((ring) => {
    const point = destination(
      site.lat,
      site.lon,
      ring.azimuthDeg,
      ring.rangeKm,
    );
    return [
      Math.round(point.lon * 1e6) / 1e6,
      Math.round(point.lat * 1e6) / 1e6,
    ];
  });
  if (polygon.length) polygon.push(polygon[0]);
  const ranges = rings.map((ring) => ring.rangeKm).filter((value) => value > 0);
  // The whole ring's land cover, not just the worst radial: a site on a
  // headland is half sea and half canopy, and one number should say so.
  const coverTotals = {};
  let coverCluttered = 0;
  let coverSamples = 0;
  for (const ring of rings) {
    if (!ring.landCover) continue;
    coverCluttered += ring.landCover.cluttered;
    coverSamples += ring.landCover.samples;
    for (const [key, count] of Object.entries(ring.landCover.histogram)) {
      coverTotals[key] = (coverTotals[key] || 0) + count;
    }
  }
  const landCover =
    coverSamples > 0
      ? {
          source: WORLDCOVER_ATTRIBUTION,
          samples: coverSamples,
          clutteredFraction:
            Math.round((coverCluttered / coverSamples) * 1000) / 1000,
          dominant:
            Object.entries(coverTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ??
            null,
          histogram: coverTotals,
        }
      : null;
  return {
    ok: true,
    site: {
      id: site.id || null,
      lat: site.lat,
      lon: site.lon,
      groundM: Math.round((groundM ?? 0) * 10) / 10,
    },
    profile: {
      tech:
        Object.keys(TECH_PROFILES).find(
          (key) => TECH_PROFILES[key] === profile,
        ) || 'custom',
      freqMhz: profile.freqMhz,
      capKm: profile.capKm,
      antennaM: Math.round(anchor.groundM + (site.heightM ?? 30)),
      toleranceDb,
      clutterModel,
      clutterBasis:
        clutterModel === 'landcover'
          ? 'worldcover-2021-class-codes'
          : clutterModel === 'roughness'
            ? 'terrain-roughness-proxy'
            : 'flat',
      tiltDeg,
      vBeamDeg: tiltDeg ? vBeamDeg : null,
    },
    rings,
    landCover,
    polygon,
    stats: {
      minKm: ranges.length ? Math.min(...ranges) : 0,
      maxKm: ranges.length ? Math.max(...ranges) : 0,
      meanKm: ranges.length
        ? Math.round(
            (ranges.reduce((sum, value) => sum + value, 0) / ranges.length) *
              100,
          ) / 100
        : 0,
      blockedAzimuths: rings.filter((ring) => ring.rangeKm === 0).length,
      // The clutter the terrain actually charged, and the worst pattern loss
      // the beam cost — the difference between this ring and the flat one.
      clutterDbMax: rings.reduce(
        (max, ring) => Math.max(max, ring.clutterDb || 0),
        0,
      ),
      patternDbMin: rings.reduce(
        (min, ring) => Math.min(min, ring.patternDb || 0),
        0,
      ),
    },
  };
}
