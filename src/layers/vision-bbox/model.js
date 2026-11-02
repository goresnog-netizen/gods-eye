/**
 * Pure geometry for the vision bbox globe overlay.
 *
 * The vision gateway reports each detection's box as a *fraction* of the image
 * — bbox = [x, y, w, h] where x/y are the top-left corner and w/h the
 * size, all in 0..1 (see server/providers/openai/vision-contract.js,
 * normalizeBox). There is no geolocation in that reply. To draw the box on
 * the globe we must anchor it to a ground footprint: the point the camera is
 * looking at, plus how much ground the photo spans (metres across and down).
 *
 * That anchor is an *estimate* — the model does not say where the photo is.
 * This module is the one place that turns "box in a picture" into "polygon on
 * the ground", and it is pure so the maths can be checked without a globe.
 *
 * @module layers/vision-bbox/model
 */

/** One degree of latitude is (approximately, on the WGS-84 mean) this many metres. */
const METRES_PER_DEG_LAT = 111320;

/**
 * A ground footprint the photo is assumed to cover, centred on a point.
 *
 * @typedef {object} Footprint
 * @property {number} lat    Centre latitude, decimal degrees.
 * @property {number} lon    Centre longitude, decimal degrees.
 * @property {number} widthM Ground extent across the photo, metres.
 * @property {number} heightM Ground extent down the photo, metres.
 */

/**
 * A ground footprint the photo spans at a camera altitude, for a vertical field of
 * view. Used only when the caller has no better measurement; it is labelled an
 * estimate wherever shown.
 *
 * @param {number} altitudeM Camera height above ground, metres.
 * @param {number} [fovDeg=60] Vertical field of view, degrees.
 * @returns {Pick<Footprint,'widthM'|'heightM'>}
 */
export function estimateFootprintM(altitudeM, fovDeg = 60) {
  const altitude = Number(altitudeM);
  if (!Number.isFinite(altitude) || altitude <= 0) {
    return { widthM: 0, heightM: 0 };
  }
  const fov = Number(fovDeg);
  const half =
    Number.isFinite(fov) && fov > 0
      ? (fov / 2) * (Math.PI / 180)
      : (60 / 2) * (Math.PI / 180);
  const halfSpan = altitude * Math.tan(half);
  return { widthM: halfSpan * 2, heightM: halfSpan * 2 };
}

/**
 * Convert a fraction-space box into a ground rectangle.
 *
 * Image x runs left→right and y runs top→bottom; the footprint is centred
 * on (lat, lon), so the box centre maps to a ground offset from that point.
 *
 * @param {number[]} box  [x, y, w, h], each in 0..1 (top-left + size).
 * @param {Footprint} footprint
 * @returns {{ lat: number, lon: number }[]} Four corners, clockwise from NW.
 *   Returns [] for a box that is not usable (wrong shape, no positive area).
 */
export function bboxToGroundRect(box, footprint) {
  if (!Array.isArray(box) || box.length !== 4) return [];
  const [x, y, w, h] = box.map((value) => Number(value));
  if ([x, y, w, h].some((value) => !Number.isFinite(value))) return [];
  const left = Math.max(0, Math.min(1, x));
  const top = Math.max(0, Math.min(1, y));
  const right = Math.min(1, left + Math.max(0, w));
  const bottom = Math.min(1, top + Math.max(0, h));
  // A box with no positive area maps to no rectangle: reporting an empty
  // polygon would be a silent lie about where something is.
  if (right - left <= 1e-6 || bottom - top <= 1e-6) return [];

  const lat = Number(footprint?.lat);
  const lon = Number(footprint?.lon);
  const widthM = Number(footprint?.widthM);
  const heightM = Number(footprint?.heightM);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(widthM) ||
    !Number.isFinite(heightM) ||
    widthM <= 0 ||
    heightM <= 0
  ) {
    return [];
  }

  // Ground metres from the footprint centre. y grows downward in the image,
  // so north is the *negative* offset.
  const eastM = (f) => (f - 0.5) * widthM;
  const northM = (f) => (0.5 - f) * heightM;
  const cosLat = Math.max(1e-4, Math.cos((Math.abs(lat) * Math.PI) / 180));
  const dLat = (nM) => nM / METRES_PER_DEG_LAT;
  const dLon = (eM) => eM / (METRES_PER_DEG_LAT * cosLat);

  const westLon = lon + dLon(eastM(left));
  const eastLon = lon + dLon(eastM(right));
  const northLat = lat + dLat(northM(top));
  const southLat = lat + dLat(northM(bottom));

  return [
    { lat: northLat, lon: westLon }, // NW
    { lat: northLat, lon: eastLon }, // NE
    { lat: southLat, lon: eastLon }, // SE
    { lat: southLat, lon: westLon }, // SW
  ];
}

/**
 * The centre of a ground rectangle, for flying the camera to it.
 * @param {Array<{lat:number, lon:number}>} corners
 * @returns {{lat:number, lon:number}|null}
 */
export function rectCentre(corners) {
  if (!Array.isArray(corners) || corners.length < 3) return null;
  let lat = 0;
  let lon = 0;
  for (const corner of corners) {
    lat += Number(corner.lat);
    lon += Number(corner.lon);
  }
  return { lat: lat / corners.length, lon: lon / corners.length };
}
