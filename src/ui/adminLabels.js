import * as Cesium from 'cesium';
import { t } from '../i18n/index.js';
import {
  ADMIN_LABEL_SOURCE,
  ADMIN_UNITS,
  LEVEL_RANGES,
  MAX_VISIBLE_LABELS,
} from '../data/adminLabels.js';

/**
 * Place names on the globe, drawn as DOM text over the canvas.
 *
 * The application deliberately does not use Cesium text labels (see
 * `noCesiumLabels.test.mjs`): names are ordinary DOM spans positioned from the
 * camera projection each frame, which keeps them crisp, selectable by CSS, and
 * free of the entity pipeline.
 *
 * What shows is a level-of-detail decision, not a data decision: provinces from
 * far out, regencies as the camera closes in, districts and villages only when
 * they can be read. The names themselves come from `src/data/adminLabels.js`.
 */

/** The level that reads at this camera height. */
export function levelForHeight(heightM) {
  const height = Number(heightM);
  if (!Number.isFinite(height) || height < 0) return LEVEL_RANGES[0].level;
  for (const range of LEVEL_RANGES) {
    if (height >= range.minHeightM) return range.level;
  }
  return LEVEL_RANGES[LEVEL_RANGES.length - 1].level;
}

/**
 * The units to show at this height.
 *
 * Lower levels crowd out higher ones as the camera drops, so a village never
 * competes with a province. The cap keeps the globe readable.
 */
export function selectVisibleUnits(
  units,
  cameraHeightM,
  { max = MAX_VISIBLE_LABELS } = {},
) {
  const level = levelForHeight(cameraHeightM);
  const list = (Array.isArray(units) ? units : []).filter(
    (unit) => Number(unit?.level) === level,
  );
  const ceiling = Number.isFinite(max) && max > 0 ? max : list.length;
  return list.slice(0, ceiling);
}

/** Counts per level, for the status line that says what is available. */
export function countByLevel(units) {
  const counts = {};
  for (const unit of units || []) {
    const level = Number(unit?.level);
    if (!Number.isFinite(level)) continue;
    counts[level] = (counts[level] || 0) + 1;
  }
  return counts;
}

/** The name as it appears, and the kind underneath it. */
export function formatUnitLabel(unit) {
  return {
    title: String(unit?.name || '—'),
    detail: String(unit?.kind || ''),
  };
}

/** One label element, reused across frames by unit id. */
function labelElement(doc, unit) {
  const { title, detail } = formatUnitLabel(unit);
  const element = doc.createElement('span');
  element.className = `admin-label level-${unit.level}`;
  element.dataset.unitId = String(unit.id || title);
  const name = doc.createElement('span');
  name.className = 'admin-label-name';
  name.textContent = title;
  const kind = doc.createElement('span');
  kind.className = 'admin-label-kind';
  kind.textContent = detail;
  element.append(name, kind);
  return element;
}

export class AdminLabelsOverlay {
  /**
   * @param {object} options
   * @param {object} options.viewer the Cesium viewer
   * @param {object} [options.units] the units to show; defaults to the seed
   * @param {boolean} [options.enabled]
   * @param {Document} [options.document]
   * @param {HTMLElement} [options.container] where labels are mounted
   * @param {{toggle?:HTMLElement, status?:HTMLElement}} [options.elements] the
   *   checkbox that switches the names on and the status line that says what
   *   the layer holds
   */
  constructor({
    viewer,
    units = ADMIN_UNITS,
    enabled = true,
    document: doc = globalThis.document,
    container = null,
    elements = {},
  } = {}) {
    this.viewer = viewer;
    this.units = Array.isArray(units) ? units : [];
    this.document = doc || globalThis.document;
    this.container =
      container || this.viewer?.container || this.document?.body || null;
    this.enabled = Boolean(enabled);
    this.elements = elements || {};
    this._root = null;
    this._nodes = new Map();
    this._onPostRender = () => this._update();
    this._onToggleChange = () => this.setEnabled(this._toggleChecked());
    this._destroyed = false;
  }

  /** Mount the label layer and start following the camera. */
  connect() {
    if (this._destroyed || !this.container) return false;
    if (!this._root) {
      const root = this.document.createElement('div');
      root.className = 'admin-labels';
      root.hidden = !this.enabled;
      this._root = root;
      this.container.appendChild(root);
    }
    const toggle = this.elements.toggle;
    if (toggle && !this._toggleWired) {
      toggle.checked = this.enabled;
      toggle.addEventListener('change', this._onToggleChange);
      this._toggleWired = true;
    }
    if (this.elements.status) {
      this.elements.status.textContent = describeUnits(this.units);
    }
    const scene = this.viewer?.scene;
    if (scene && !this._connected) {
      scene.postRender.addEventListener(this._onPostRender);
      this._connected = true;
    }
    if (!this.enabled) this._clear();
    return true;
  }

  /** Show or hide the names without unloading the data. */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.elements.toggle) this.elements.toggle.checked = this.enabled;
    if (this._root) this._root.hidden = !this.enabled;
    if (!this.enabled) this._clear();
    return this.enabled;
  }

  _toggleChecked() {
    return Boolean(this.elements.toggle?.checked);
  }

  /** Stop following the camera and remove every label. */
  destroy() {
    this._destroyed = true;
    const toggle = this.elements.toggle;
    if (toggle && this._toggleWired) {
      toggle.removeEventListener('change', this._onToggleChange);
    }
    this._toggleWired = false;
    const scene = this.viewer?.scene;
    if (scene && this._connected) {
      scene.postRender.removeEventListener(this._onPostRender);
    }
    this._connected = false;
    this._clear();
    this._root?.remove?.();
    this._root = null;
    this._nodes.clear();
  }

  _clear() {
    for (const node of this._nodes.values()) node.remove?.();
    this._nodes.clear();
  }

  _update() {
    if (this._destroyed || !this.enabled || !this._root) return;
    const canvas = this.viewer?.scene?.canvas;
    const camera = this.viewer?.camera;
    const scene = this.viewer?.scene;
    if (!canvas || !camera || !scene) return;
    const height = camera.positionCartographic?.height;
    const units = selectVisibleUnits(this.units, height);
    const width = canvas.clientWidth || 0;
    const heightPx = canvas.clientHeight || 0;
    const seen = new Set();

    for (const unit of units) {
      const point = Cesium.Cartesian3.fromDegrees(unit.lon, unit.lat, 0);
      const screen = scene.cartesianToCanvasCoordinates(point);
      if (!screen) continue;
      const x = Number(screen.x);
      const y = Number(screen.y);
      // Behind the globe, or far enough outside the frame to be unreadable.
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < -120 || y < -60 || x > width + 120 || y > heightPx + 60) continue;
      seen.add(String(unit.id));
      let node = this._nodes.get(String(unit.id));
      if (!node) {
        node = labelElement(this.document, unit);
        this._nodes.set(String(unit.id), node);
        this._root.appendChild(node);
      }
      node.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      node.hidden = false;
    }

    for (const [id, node] of this._nodes) {
      if (seen.has(id)) continue;
      node.remove?.();
      this._nodes.delete(id);
    }
  }
}

/** The status line text: what the layer holds and where it came from. */
export function describeUnits(units, source = ADMIN_LABEL_SOURCE) {
  const counts = countByLevel(units);
  const parts = Object.keys(counts)
    .sort()
    .map((level) => `${counts[level]} × ${t(`ADMIN LEVEL ${level}`)}`);
  const label = parts.length ? parts.join(' · ') : t('NO PLACES');
  return `${label} · ${source}`;
}
