/**
 * Regions the operator reaches for often.
 *
 * A preset is a region hint plus a radius that suits the scale of the place.
 * The hint is a **geocoder query**, not display text: it goes to Nominatim as
 * written, so it must not be translated. The display wording lives in the
 * panel markup (data-i18n), and the ids here only pair a button with its
 * values.
 */

/**
 * @typedef {object} RegionPreset
 * @property {string} id stable id, used by the panel to pair a button
 * @property {string} hint region or country written for the geocoder
 * @property {number} radiusKm a radius that suits the scale of the region
 */

/** @type {ReadonlyArray<RegionPreset>} */
export const REGION_PRESETS = Object.freeze([
  Object.freeze({ id: 'indonesia', hint: 'Indonesia', radiusKm: 50 }),
  Object.freeze({ id: 'papua', hint: 'Papua, Indonesia', radiusKm: 100 }),
]);

/**
 * One preset by id.
 *
 * @param {string} id
 * @returns {RegionPreset|null}
 */
export function findRegionPreset(id) {
  const wanted = String(id || '')
    .trim()
    .toLowerCase();
  return REGION_PRESETS.find((preset) => preset.id === wanted) || null;
}
