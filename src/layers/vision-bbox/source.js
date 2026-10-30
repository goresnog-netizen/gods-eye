/**
 * Vision bbox source — accepts detections from the OpenAI vision gateway and
 * converts them to a list of polygons ready for the overlay host.
 *
 * @module layers/vision-bbox/source
 */
import { bboxToGroundRect, rectCentre } from './model.js';

/**
 * A detection the vision gateway returns.
 * @typedef {object} Detection
 * @property {string} kind        'person' or 'vehicle'
 * @property {number[]} box       [x, y, w, h] in 0..1 fractions
 * @property {number} [confidence]
 */

/**
 * @typedef {object} VisionBboxSnapshot
 * @property {Detection[]} detections
 * @property {import('./model.js').Footprint|null} footprint
 */

/**
 * Create a vision-bbox source.
 *
 * @param {object} [options]
 * @param {object} [options.overlayHost] - worldOverlayHost ({ setEntries })
 * @returns {{ setDetections, clear, snapshot, flyToDetection }}
 */
export function createVisionBboxSource({ overlayHost } = {}) {
  let _detections = [];
  let _footprint = null;

  return {
    setDetections(detections, footprint) {
      _detections = Array.isArray(detections) ? detections : [];
      _footprint = footprint && overlayHost && typeof overlayHost.setEntries === 'function' ? { ...footprint } : null;
      if (!overlayHost || typeof overlayHost.setEntries !== 'function') {
        return 0;
      }
      const entries = [];
      for (const det of _detections) {
        const poly = _footprint ? bboxToGroundRect(det.box, _footprint) : [];
        if (!poly.length) continue;
        entries.push({
          id: `vision-${det.kind}-${Math.random().toString(36).slice(2, 8)}`,
          kind: det.kind,
          confidence: det.confidence || 0,
          polygon: {
            positions: poly,
            material:
              det.kind === 'person'
                ? { color: '#ff3333', alpha: 0.55 }
                : { color: '#ffcc00', alpha: 0.5 },
          },
        });
      }
      overlayHost.setEntries(entries);
      return entries.length;
    },

    clear() {
      _detections = [];
      _footprint = null;
      overlayHost?.setEntries?.([]);
      return 0;
    },

    snapshot() {
      return { detections: [..._detections], footprint: _footprint ? { ..._footprint } : null };
    },

    flyToDetection(index) {
      const det = _detections[Number(index)];
      if (!det || !_footprint) return null;
      const poly = bboxToGroundRect(det.box, _footprint);
      return rectCentre(poly);
    },
  };
}
