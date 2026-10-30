import { t } from '../i18n/index.js';

/**
 * The target research panel: one named target, three answers.
 *
 * POSITION says where the target is, INVOLVEMENT says how much of it is
 * online, NEARBY ACTORS says who is around it. The panel owns no data of its
 * own: it asks the server for the profile and renders what comes back. A
 * block whose source is unavailable is shown as unavailable, never as zero.
 */

const TARGET_ENDPOINT = '/api/godseye/target';
const DEFAULT_RADIUS_KM = 25;

/**
 * Regions the operator reaches for often.
 *
 * A preset only fills the region hint and a radius that suits the scale of
 * the place; the target itself is still typed, because a name alone is
 * ambiguous in a region this large.
 */
export const REGION_PRESETS = Object.freeze({
  indonesia: {
    element: '_godseyePresetIndonesia',
    // i18n-ignore: geocoder query, never translated
    hint: 'Indonesia',
    radiusKm: 50,
  },
  papua: {
    element: '_godseyePresetPapua',
    // i18n-ignore: geocoder query, never translated
    hint: 'Papua, Indonesia',
    radiusKm: 100,
  },
});

/** A date in the short form the panel shows next to a headline. */
function shortDate(value) {
  if (!Number.isFinite(value)) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export class GodsEyeTarget {
  /**
   * @param {object} options
   * @param {object} options.elements the panel elements
   * @param {object} options.services the application services
   * @param {Document} [options.document]
   */
  constructor({ elements, services, document: doc } = {}) {
    this.elements = elements || {};
    this.services = services || {};
    this.document = doc || globalThis.document;
    this._disposed = false;
    this._pending = null;
  }

  /** Wire the panel. Nothing is fetched before the operator asks. */
  connect() {
    const { _godseyeTargetBtn, _godseyeTargetInput } = this.elements;
    _godseyeTargetBtn?.addEventListener('click', () => this.research());
    _godseyeTargetInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.research();
    });
    this.elements._godseyeTargetHint?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.research();
    });
    for (const preset of Object.values(REGION_PRESETS)) {
      this.elements[preset.element]?.addEventListener('click', () =>
        this._applyPreset(preset),
      );
    }
    return undefined;
  }

  /**
   * Isi hint wilayah + radius dari preset.
   *
   * @param {{hint:string, radiusKm:number}} preset
   * @returns {void}
   */
  _applyPreset(preset) {
    const hint = this.elements._godseyeTargetHint;
    if (hint && typeof preset?.hint === 'string') hint.value = preset.hint;
    const radius = this.elements._godseyeTargetRadius;
    if (radius && Number.isFinite(preset?.radiusKm)) {
      radius.value = String(preset.radiusKm);
    }
  }

  /** Hint wilayah yang dipakai untuk=share nama target. */
  _hint() {
    return String(this.elements._godseyeTargetHint?.value || '').trim();
  }

  /** Release listeners and pending work. */
  destroy() {
    this._disposed = true;
    this._pending?.abort?.();
    this._pending = null;
  }

  /** The radius the operator asked for, in kilometres. */
  _radiusKm() {
    const value = Number(this.elements._godseyeTargetRadius?.value);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_RADIUS_KM;
    return Math.min(100, Math.floor(value));
  }

  async research() {
    if (this._disposed) return;
    const { _godseyeTargetInput, _godseyeTargetStatus } = this.elements;
    const target = String(_godseyeTargetInput?.value || '').trim();
    if (!target) {
      this._setStatus(t('ENTER A TARGET NAME'));
      return;
    }
    this._setStatus(t('LOADING'));
    this._clearBlocks();
    this._pending?.abort?.();
    const controller = new AbortController();
    this._pending = controller;
    const hint = this._hint();
    const endpoint = `${TARGET_ENDPOINT}?target=${encodeURIComponent(target)}&radiusKm=${this._radiusKm()}${hint ? `&hint=${encodeURIComponent(hint)}` : ''}`;
    try {
      const response = await this._request(endpoint, {
        signal: controller.signal,
      });
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || `HTTP ${response.status}`);
      }
      this._render(response.data || {});
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      this._setStatus(error?.message || t('UNAVAILABLE'));
      this._clearBlocks();
    }
  }

  _setStatus(text) {
    const status = this.elements._godseyeTargetStatus;
    if (status) status.textContent = String(text || '');
  }

  _clearBlocks() {
    for (const block of [
      this.elements._godseyeTargetPosition,
      this.elements._godseyeTargetInvolvement,
      this.elements._godseyeTargetNearby,
    ]) {
      block?.replaceChildren();
    }
  }

  _element(tag, className, text) {
    const node = this.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  _render(profile) {
    this._renderPosition(profile.position || null);
    this._renderInvolvement(profile.involvement || null);
    this._renderNearby(profile.nearby || null);
    const sources = Array.isArray(profile.sources) ? profile.sources : [];
    const failed = sources.filter((source) => !source.ok).length;
    this._setStatus(failed ? t('UNAVAILABLE') : '');
  }

  _renderPosition(position) {
    const block = this.elements._godseyeTargetPosition;
    if (!block) return;
    if (!position || position.status !== 'ok') {
      block.replaceChildren(
        this._element(
          'p',
          'godseye-target-empty',
          position?.detail || t('UNAVAILABLE'),
        ),
      );
      return;
    }
    const name = this._element('p', 'godseye-target-name', position.name || '');
    const coords = this._element(
      'p',
      'godseye-target-coords',
      `${Number(position.lat).toFixed(5)}, ${Number(position.lon).toFixed(5)}`,
    );
    const radius = this._element(
      'p',
      'godseye-target-meta',
      `${position.radiusKm} km`,
    );
    block.replaceChildren(name, coords, radius);
  }

  _renderInvolvement(involvement) {
    const block = this.elements._godseyeTargetInvolvement;
    if (!block) return;
    if (!involvement || involvement.status === 'unavailable') {
      block.replaceChildren(
        this._element(
          'p',
          'godseye-target-empty',
          involvement?.note || t('UNAVAILABLE'),
        ),
      );
      return;
    }
    const rows = [];
    const sources = Array.isArray(involvement.bySource)
      ? involvement.bySource
      : [];
    const top = Array.isArray(involvement.top) ? involvement.top : [];
    if (!sources.length && !top.length) {
      block.replaceChildren(
        this._element('p', 'godseye-target-empty', t('NO RESULTS')),
      );
      return;
    }
    for (const entry of sources) {
      const row = this._element('li', 'godseye-target-row');
      row.append(
        this._element('span', 'godseye-target-row-label', entry.source),
        this._element('span', 'godseye-target-row-value', String(entry.count)),
      );
      rows.push(row);
    }
    for (const item of top) {
      const row = this._element('li', 'godseye-target-row');
      const label = this._element(
        'span',
        'godseye-target-row-label',
        item.title,
      );
      const when = shortDate(item.publishedAt);
      const value = this._element(
        'span',
        'godseye-target-row-value',
        when ? `${item.source} · ${when}` : item.source,
      );
      row.append(label, value);
      rows.push(row);
    }
    const list = this._element('ul', 'godseye-target-list');
    for (const row of rows) list.append(row);
    const summary = this._element(
      'p',
      'godseye-target-meta',
      involvement.summary || '',
    );
    block.replaceChildren(summary, list);
  }

  _renderNearby(nearby) {
    const block = this.elements._godseyeTargetNearby;
    if (!block) return;
    if (!nearby || nearby.status === 'unavailable') {
      block.replaceChildren(
        this._element(
          'p',
          'godseye-target-empty',
          nearby?.detail || t('UNAVAILABLE'),
        ),
      );
      return;
    }
    const items = Array.isArray(nearby.items) ? nearby.items : [];
    if (!items.length) {
      block.replaceChildren(
        this._element('p', 'godseye-target-empty', t('NO RESULTS')),
      );
      return;
    }
    const list = this._element('ul', 'godseye-target-list');
    for (const item of items) {
      const row = this._element('li', 'godseye-target-row');
      row.append(
        this._element('span', 'godseye-target-row-label', item.name),
        this._element('span', 'godseye-target-row-kind', item.kind),
        this._element(
          'span',
          'godseye-target-row-value',
          `${Number(item.distanceKm).toFixed(2)} km`,
        ),
      );
      list.append(row);
    }
    block.replaceChildren(list);
  }

  async _request(endpoint, options = {}) {
    const service = this.services?.godseye;
    if (service?.raw) return service.raw(endpoint, options);
    const response = await fetch(endpoint, {
      ...options,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* The status stays authoritative for a non-JSON error. */
    }
    return { ok: response.ok, status: response.status, data };
  }
}
