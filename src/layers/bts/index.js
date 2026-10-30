import * as Cesium from 'cesium';

import { createBtsSource } from './source.js';
import {
  densityTier,
  layerStatus,
  selectVisibleSites,
  sitesFromPayload,
  techColor,
} from './model.js';
export * from './model.js';

// A portable package (no i18n): the layer's own strings stay English data and
// the panel shows them translated.
const msg = (text) => text;

/** Where a tower's marker sits above the ground it stands on. */
const MARKER_HEIGHT_M = 12;

/**
 * The cell-tower layer: 1,901 real towers from the OpenCellID registry, drawn
 * at a density that follows the camera.
 *
 * The point is not "draw every tower". It is that the globe answers the
 * question the operator is asking: far out, the province summary; closer, the
 * towers; close enough, the cells and their ranges. A flat list of 1,901 pins
 * at every zoom would be both unreadable and useless.
 */
export function createBtsLayer({ source, overlayHost } = {}) {
  // The registry is a local artifact, so the layer can read it itself: no
  // provider key to hold, and nothing that has to be wired from outside.
  const registry = source || createBtsSource();
  if (typeof registry?.getSnapshot !== 'function')
    throw new TypeError('BTS requires a snapshot source');

  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _sites = [];
  let _meta = { source: 'local', synthetic: true };
  let _enabled = false;
  let _tier = 'province';
  let _shown = 0;
  let _lastError = null;
  let _moveEnd = null;

  const layer = {
    id: 'bts',
    name: 'Cell towers',
    icon: '📡',
    source: 'OpenCellID + local registry',
    updateInterval: 300000,

    init(viewer) {
      if (_viewer) throw new Error('BTS layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('bts');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      // The density policy needs the camera; without it the layer would draw
      // the same thing at every zoom, which is the bug this layer avoids.
      _moveEnd = viewer.camera.moveEnd.addEventListener(() => _applyDensity());
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      _applyDensity();
      if (!_sites.length) layer.update(viewer);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      _dataSource?.entities.removeAll();
      _shown = 0;
      _tier = 'province';
    },

    destroy() {
      if (_moveEnd && !_moveEnd.isRemoved?.()) _moveEnd();
      if (_dataSource && _viewer) _viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await registry.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _sites = sitesFromPayload(snapshot);
        _meta = { source: snapshot.source, synthetic: snapshot.synthetic };
        _lastError = null;
        _applyDensity();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || msg('registry unavailable');
        return false;
      }
    },

    /** What the layer reports to the status line. */
    status() {
      const status = layerStatus({
        total: _sites.length,
        shown: _shown,
        tier: _tier,
        altitudeM: _viewer ? _viewer.camera.positionCartographic.height : null,
      });
      if (_lastError) status.error = _lastError;
      if (_meta.synthetic) status.synthetic = true;
      return status;
    },
  };

  /**
   * Redraw for the camera's current altitude.
   *
   * Cheap by design: the selection is a filter over an in-memory array, and
   * the entities are only rebuilt when the tier actually changes. Dragging the
   * globe therefore does not rebuild 400 entities per frame.
   */
  function _applyDensity() {
    if (!_viewer || !_dataSource || !_enabled) return;
    const height = _viewer.camera.positionCartographic.height;
    const tier = densityTier(height);
    const focus = _cameraFocus();
    const visible = selectVisibleSites(_sites, focus, tier);
    if (tier === _tier && visible.length === _shown) return;

    _dataSource.entities.removeAll();
    for (const site of visible) {
      const color = Cesium.Color.fromCssColorString(techColor(site.tech));
      _dataSource.entities.add({
        id: `bts-${site.id}`,
        position: Cesium.Cartesian3.fromDegrees(
          site.lon,
          site.lat,
          MARKER_HEIGHT_M,
        ),
        point: {
          pixelSize: tier === 'cells' ? 7 : 4,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          // Disable the depth test so a marker in a valley is still visible
          // through the ridge in front of it — the terrain is the whole point
          // of the range model, and a hidden marker says nothing.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        // Site names are rendered through the world overlay host, not Cesium
        // labels (overlays/worldOverlay.js). No Cesium label API here.
        // The planning radius, drawn only when it means something: a 35 km
        // circle at a zoom where a pixel is 2 km is a smudge.
        ellipse:
          tier === 'cells' && Number.isFinite(site.rangeKm) && site.rangeKm > 0
            ? {
                semiMajorAxis: site.rangeKm * 1000,
                semiMinorAxis: site.rangeKm * 1000,
                material: color.withAlpha(0.15),
                outline: true,
                outlineColor: color.withAlpha(0.5),
              }
            : undefined,
        properties: {
          kind: 'bts',
          name: site.name,
          tech: site.tech,
          cells: site.cells,
          distanceKm: site.distanceKm,
        },
      });
    }
    _tier = tier;
    _shown = visible.length;
    overlayHost?.setVisible?.('bts', true);
  }

  /** The point the camera is looking at, for the nearest-first selection. */
  function _cameraFocus() {
    const center = _viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(
        _viewer.canvas.clientWidth / 2,
        _viewer.canvas.clientHeight / 2,
      ),
    );
    if (!center) return null;
    const carto = Cesium.Cartographic.fromCartesian(center);
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  }

  return layer;
}
