/**
 * Sharpen the globe when the camera is close enough to pay for it.
 *
 * Cesium's default `maximumScreenSpaceError` is 2 px. That is a good global
 * compromise, but at street-to-village range it leaves visible imagery soft:
 * measured at 1 200 m over Waena the tiles were still one level coarser than
 * the screen could show. Below a few kilometres only a handful of tiles are on
 * screen, so asking for 1 px costs little and is the difference between a
 * blurred village and readable rooftops.
 *
 * The far setting is left exactly at Cesium's default so nothing about the
 * world view or the flight between them changes.
 */

/** Altitude at or below which the sharper setting applies. */
export const DETAIL_NEAR_M = 6000;

/** Screen-space error in pixels while close. Lower is sharper and heavier. */
export const DETAIL_NEAR_ERROR = 1;

/** Cesium's own default, kept for every other altitude. */
export const DETAIL_FAR_ERROR = 2;

/**
 * @param {number} heightM Camera height above the ellipsoid.
 * @returns {number} Screen-space error to request.
 */
export function detailErrorForHeight(heightM) {
  if (!Number.isFinite(heightM)) return DETAIL_FAR_ERROR;
  return heightM <= DETAIL_NEAR_M ? DETAIL_NEAR_ERROR : DETAIL_FAR_ERROR;
}

/**
 * Keep `globe.maximumScreenSpaceError` in step with camera altitude.
 * @param {object} viewer A Cesium viewer.
 * @param {object} [options]
 * @param {number} [options.nearM] Override the close-range threshold.
 * @returns {() => void} Removes the listener.
 */
export function installCloseRangeDetail(
  viewer,
  { nearM = DETAIL_NEAR_M } = {},
) {
  const camera = viewer?.camera;
  const globe = viewer?.scene?.globe;
  if (!camera?.changed || !globe) return () => {};

  const apply = () => {
    if (viewer.isDestroyed?.()) return;
    const height = camera.positionCartographic?.height;
    const next =
      Number.isFinite(height) && height <= nearM
        ? DETAIL_NEAR_ERROR
        : DETAIL_FAR_ERROR;
    if (globe.maximumScreenSpaceError !== next) {
      globe.maximumScreenSpaceError = next;
    }
  };

  // Fire on a coarse camera change rather than every frame: the value only
  // needs to be right when the movement stops being tiny.
  camera.percentageChanged = 0.02;
  const remove = camera.changed.addEventListener(apply);
  apply();
  return () => {
    if (typeof remove === 'function') remove();
  };
}
