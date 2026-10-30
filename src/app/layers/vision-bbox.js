/**
 * @module app/layers/vision-bbox
 * @description Wire the vision bbox overlay to the application overlay host.
 *
 * The vision-bbox layer is ephemeral: it is created on-demand when the VISION
 * panel is used and destroyed when it is closed. It does not appear in the
 * layer catalog, so it does not need a voice manifest entry, a LAYER_NAME_KEYS
 * entry, or a layer-catalog row.
 */
import { createVisionBboxLayer } from '../../layers/vision-bbox/index.js';
import { overlayHost } from './overlayHost.js';

let _layer = null;

/**
 * Get or create the vision bbox layer.
 * @returns {ReturnType<typeof createVisionBboxLayer>}
 */
export function getVisionBboxLayer() {
  if (_layer) return _layer;
  _layer = createVisionBboxLayer({ overlayHost });
  return _layer;
}

/**
 * Draw vision detections on the globe.
 * @param {Array<{kind:'person'|'vehicle', box:number[], confidence?:number}>} detections
 * @param {object} footprint - { lat, lon, widthM, heightM }
 * @returns {number} Number of polygons drawn.
 */
export function drawVisionDetections(detections, footprint) {
  const layer = getVisionBboxLayer();
  return layer.setDetections(detections, footprint);
}

/**
 * Clear vision detections from the globe.
 */
export function clearVisionDetections() {
  const layer = getVisionBboxLayer();
  layer.clear();
}

/**
 * Fly the camera to a detection by index.
 * @param {number} index
 */
export function flyToVisionDetection(index) {
  const layer = getVisionBboxLayer();
  layer.flyToDetection(index);
}

/**
 * Destroy the vision bbox layer (cleanup).
 */
export function destroyVisionBboxLayer() {
  if (_layer) {
    _layer.destroy();
    _layer = null;
  }
}
