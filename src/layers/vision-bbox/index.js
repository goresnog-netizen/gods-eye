/**
 * Vision bbox layer — draws detections from the OpenAI vision gateway onto the
 * Cesium globe as semi-transparent polygons.
 *
 * This is an *ephemeral* layer: it is created on demand when the VISION panel
 * is used and destroyed when it is closed. It does not appear in the catalog
 * or the layer panel, so it does not need a voice manifest entry, a
 * LAYER_NAME_KEYS entry, or a layer-catalog row. It also does not create
 * Cesium Label instances (labels belong on the world overlay host).
 *
 * @module layers/vision-bbox/index
 */
import { createVisionBboxSource } from './source.js';
import * as Cesium from 'cesium';

/**
 * The layer id for the vision bbox overlay.
 * @type {string}
 */
export const LAYER_ID = 'vision-bbox';

/**
 * Create the vision-bbox globe layer.
 *
 * @param {object} options
 * @param {object} options.overlayHost - worldOverlayHost ({ setEntries, getDiagnostics })
 * @returns {{ id, name, icon, source, init, enable, disable, destroy, setDetections, clear, flyToDetection }}
 */
export function createVisionBboxLayer({ overlayHost } = {}) {
  if (!overlayHost || typeof overlayHost.setEntries !== 'function') {
    throw new Error('visionBbox requires overlayHost');
  }

  const source = createVisionBboxSource({ overlayHost });
  let _enabled = false;
  let _viewer = null;

  const layer = {
    id: LAYER_ID,
    name: 'Vision Detections',
    icon: '🔍',
    source: 'OpenAI vision gateway',

    init(viewer) {
      if (_viewer) throw new Error('vision-bbox layer is already initialized');
      _viewer = viewer;
      return this;
    },

    enable() {
      _enabled = true;
    },

    disable() {
      _enabled = false;
      this.clear();
    },

    destroy() {
      this.clear();
      _viewer = null;
    },

    setDetections(detections, footprint) {
      return source.setDetections(detections, footprint);
    },

    clear() {
      return source.clear();
    },

    flyToDetection(index) {
      const point = source.flyToDetection(index);
      if (!point || !_viewer) return;
      _viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          point.lon,
          point.lat,
          1000,
        ),
        duration: 2.0,
      });
    },
  };

  return layer;
}

export { bboxToGroundRect, rectCentre, estimateFootprintM } from './model.js';
