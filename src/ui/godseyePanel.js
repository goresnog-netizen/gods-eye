import { t } from '../i18n/index.js';

/**
 * The God's Eye analysis panel: what is moving gold right now (Gold Impact)
 * and what a place looks like from the street (Place Card).
 *
 * The panel owns no data of its own: it asks the server for the feed and the
 * card, then renders them. Every value that comes back is shown as it is, and
 * a source that is unavailable is reported as unavailable rather than as zero.
 */

const GOLD_IMPACT_ENDPOINT = '/api/godseye/gold-impact';
const PLACE_CARD_ENDPOINT = '/api/godseye/place-card';
const VISION_ENDPOINT = '/api/openai/vision';
const CCTV_ENDPOINT = '/api/godseye/cctv';
const LOCATE_ENDPOINT = '/api/godseye/locate';
const NEWS_ENDPOINT = '/api/godseye/news';
const STREAM_ENDPOINT = '/api/godseye/stream';
const BTS_ENDPOINT = '/api/godseye/bts';
const IMAGERY_ENDPOINT = '/api/godseye/imagery';
const VERIFY_ENDPOINT = '/api/godseye/verify';
const DRIVER_LIMIT = 8;
const CCTV_LIMIT = 12;
const NEWS_LIMIT = 20;

/**
 * Read a `lat, lon` pair typed by hand.
 *
 * Only an explicit pair is accepted: guessing a place name here would need the
 * geocoder, and this tab is meant to answer from what is already on screen.
 */
function parseCoordinatePair(text) {
  const match = String(text || '').match(
    /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/,
  );
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Direction arrow for a score: flat inside the noise band, otherwise its sign.
 *
 * The arrow is derived from the number rather than from a direction word, so
 * the panel shows the same picture in every locale.
 */
function impactArrow(impact) {
  const value = Number.isFinite(impact) ? impact : 0;
  if (Math.abs(value) < 0.05) return '▬';
  return value > 0 ? '▲' : '▼';
}

/** One driver row: direction, label and score. */
function driverRow(document, driver) {
  const row = document.createElement('li');
  row.className = 'godseye-driver';
  const value = Number.isFinite(driver.impact) ? driver.impact : 0;
  const arrow = document.createElement('span');
  arrow.className = `godseye-driver-arrow ${value >= 0 ? 'is-pos' : 'is-neg'}`;
  arrow.textContent = impactArrow(value);
  const label = document.createElement('span');
  label.className = 'godseye-driver-label';
  label.textContent = driver.label;
  const score = document.createElement('span');
  score.className = 'godseye-driver-score';
  score.textContent = driver.impact.toFixed(2);
  row.append(arrow, label, score);
  return row;
}

/**
 * Scale normalised boxes to the pixels of the displayed image.
 *
 * A box is [x, y, width, height] in 0..1 of the source image, the contract
 * the vision pipeline returns.
 *
 * @param {object} detections the parsed scene answer
 * @param {object} sizes the source and the displayed size
 * @returns {Array<{kind:string,label:string,confidence:number,x:number,y:number,width:number,height:number}>}
 */
export function scaleDetections(detections, sizes) {
  const rects = [];
  const naturalWidth = Number(sizes?.naturalWidth);
  const naturalHeight = Number(sizes?.naturalHeight);
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return rects;
  }
  const viewWidth = Number(sizes?.viewWidth) || naturalWidth;
  const viewHeight = Number(sizes?.viewHeight) || naturalHeight;
  // A normalised box is a fraction of the SOURCE image, so it maps to the
  // displayed size directly; the source size only has to be sane.
  const push = (box, kind, label, confidence) => {
    if (!Array.isArray(box) || box.length !== 4) return;
    const values = box.map((value) => Number(value));
    if (!values.every((value) => Number.isFinite(value))) return;
    const [x, y, width, height] = values;
    if (width <= 0 || height <= 0) return;
    rects.push({
      kind,
      label,
      confidence,
      x: x * viewWidth,
      y: y * viewHeight,
      width: width * viewWidth,
      height: height * viewHeight,
    });
  };
  for (const person of detections?.people || []) {
    push(person?.bbox, 'person', person?.activity || '—', person?.confidence);
  }
  for (const vehicle of detections?.vehicles || []) {
    push(vehicle?.bbox, 'vehicle', vehicle?.type || '—', vehicle?.confidence);
  }
  return rects;
}

/** Render the analysis panel contents. */
export class GodsEyePanel {
  /**
   * @param {object} options
   * @param {object} options.elements the panel elements
   * @param {object} options.services the application services
   * @param {(query:string)=>void} [options.flyTo] camera flight by place name
   * @param {(lat:number, lon:number, altitude?:number)=>void} [options.flyToPoint]
   *   camera flight to an exact position, used by the target and CCTV tabs
   */
  constructor({
    elements,
    services,
    flyTo = null,
    flyToPoint = null,
    document: doc,
  } = {}) {
    this.elements = elements || {};
    this.services = services || {};
    this.flyTo = flyTo;
    this.flyToPoint = flyToPoint;
    this.document = doc || globalThis.document;
    this._disposed = false;
    this._latestRequest = null;
    this._placeRequest = null;
    this._cctvRequest = null;
    this._locateRequest = null;
    this._newsRequest = null;
    this._newsLoaded = false;
    this._btsLoaded = false;
    this._liveSource = null;
  }

  /** Wire the panel and load the first feed. */
  connect() {
    const {
      _godseyeTabLatest,
      _godseyeTabPlace,
      _godseyeRefreshBtn,
      _godseyePlaceBtn,
      _godseyePlaceInput,
      _godseyeFlyBtn,
    } = this.elements;
    _godseyeTabLatest?.addEventListener('click', () =>
      this._selectTab('latest'),
    );
    _godseyeTabPlace?.addEventListener('click', () => this._selectTab('place'));
    _godseyeRefreshBtn?.addEventListener('click', () =>
      this._loadLatest({ force: true }),
    );
    _godseyePlaceBtn?.addEventListener('click', () => this._lookupPlace());
    _godseyeFlyBtn?.addEventListener('click', () => {
      if (this._place) this.flyTo?.(this._place.name);
    });
    _godseyePlaceInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this._lookupPlace();
    });
    this.elements._godseyeTabVision?.addEventListener('click', () =>
      this._selectTab('vision'),
    );
    this.elements._godseyeVisionBtn?.addEventListener('click', () =>
      this._analyseVision(),
    );
    this.elements._godseyeVisionFile?.addEventListener('change', () =>
      this._analyseVision(),
    );
    this.elements._godseyeTabCctv?.addEventListener('click', () =>
      this._selectTab('cctv'),
    );
    this.elements._godseyeTabNews?.addEventListener('click', () => {
      this._selectTab('news');
      if (!this._newsLoaded) this._loadNews();
    });
    this.elements._godseyeNewsBtn?.addEventListener('click', () =>
      this._loadNews(),
    );
    this.elements._godseyeNewsRegion?.addEventListener('change', () =>
      this._loadNews(),
    );
    this.elements._godseyeCctvBtn?.addEventListener('click', () =>
      this._scanCctv(),
    );
    this.elements._godseyeCctvInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this._scanCctv();
    });
    this.elements._godseyeTabBts?.addEventListener('click', () => {
      this._selectTab('bts');
      if (!this._btsLoaded) this._loadBts();
    });
    this.elements._godseyeBtsRefresh?.addEventListener('click', () =>
      this._loadBts(),
    );
    this.elements._godseyeBtsViewshedBtn?.addEventListener('click', () =>
      this._loadViewshed(),
    );
    this.elements._godseyeBtsViewshedInput?.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this._loadViewshed();
      },
    );
    this.elements._godseyeTabLocate?.addEventListener('click', () =>
      this._selectTab('locate'),
    );
    this.elements._godseyeLocateBtn?.addEventListener('click', () =>
      this._locateTarget(),
    );
    this.elements._godseyeLocateInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this._locateTarget();
    });
    this.elements._godseyeLocateFly?.addEventListener('click', () =>
      this._flyToLocated(),
    );
    this._selectTab('latest');
    this._startLive();
    return this._loadLatest();
  }

  /** Release listeners and pending work. */
  destroy() {
    this._disposed = true;
    this._stopLive();
    this._latestRequest?.abort?.();
    this._placeRequest?.abort?.();
    this._cctvRequest?.abort?.();
    this._locateRequest?.abort?.();
    this._newsRequest?.abort?.();
    this._latestRequest = null;
    this._placeRequest = null;
    this._cctvRequest = null;
    this._locateRequest = null;
    this._newsRequest = null;
  }

  /**
   * Follow the server's live snapshot.
   *
   * A server-sent stream rather than a socket: the panel only reads, and the
   * browser reconnects by itself when the dev server restarts.
   */
  _startLive() {
    if (this._disposed || this._liveSource) return;
    if (typeof EventSource === 'undefined') return;
    let source = null;
    try {
      source = new EventSource(STREAM_ENDPOINT);
    } catch {
      return;
    }
    source.addEventListener('message', (event) =>
      this._renderLive(event?.data),
    );
    source.addEventListener('error', () => {
      // The stream retries on its own, so the badge only stops claiming live.
      this.elements._godseyeLive?.classList.remove('is-live');
    });
    this._liveSource = source;
  }

  _renderLive(raw) {
    const badge = this.elements._godseyeLive;
    if (!badge) return;
    let snapshot = null;
    try {
      snapshot = JSON.parse(String(raw ?? ''));
    } catch {
      return;
    }
    if (!snapshot || typeof snapshot !== 'object') return;
    badge.textContent = `${t('LIVE')} · ${snapshot.cctv} ${t('CCTV')} · ${snapshot.targets} ${t('TARGET')}`;
    badge.classList.add('is-live');
  }

  _stopLive() {
    this._liveSource?.close?.();
    this._liveSource = null;
  }

  _selectTab(name) {
    const {
      _godseyeTabLatest,
      _godseyeTabNews,
      _godseyeTabPlace,
      _godseyeTabVision,
      _godseyeTabCctv,
      _godseyeTabBts,
      _godseyeBtsViewshedInput,
      _godseyeBtsViewshedBtn,
      _godseyeBtsViewshed,
      _godseyeTabLocate,
      _godseyePaneLatest,
      _godseyePaneNews,
      _godseyePanePlace,
      _godseyePaneVision,
      _godseyePaneCctv,
      _godseyePaneBts,
      _godseyePaneLocate,
    } = this.elements;
    const tabs = [
      ['latest', _godseyeTabLatest, _godseyePaneLatest],
      ['news', _godseyeTabNews, _godseyePaneNews],
      ['place', _godseyeTabPlace, _godseyePanePlace],
      ['vision', _godseyeTabVision, _godseyePaneVision],
      ['cctv', _godseyeTabCctv, _godseyePaneCctv],
      ['bts', _godseyeTabBts, _godseyePaneBts],
      ['locate', _godseyeTabLocate, _godseyePaneLocate],
    ];
    for (const [id, tab, pane] of tabs) {
      const active = id === name;
      if (tab) {
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      if (pane) pane.hidden = !active;
    }
  }

  async _loadLatest({ force = false } = {}) {
    if (this._disposed) return;
    const {
      _godseyeGoldPrice,
      _godseyeGoldChange,
      _godseyeComposite,
      _godseyeDrivers,
      _godseyeLatestStatus,
    } = this.elements;
    if (_godseyeLatestStatus) _godseyeLatestStatus.textContent = t('LOADING');
    this._latestRequest?.abort?.();
    const controller = new AbortController();
    this._latestRequest = controller;
    try {
      const response = await this._request(
        `${GOLD_IMPACT_ENDPOINT}?top=${DRIVER_LIMIT}`,
        { signal: controller.signal },
      );
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || `HTTP ${response.status}`);
      }
      this._renderLatest(response.data);
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyeLatestStatus) {
        _godseyeLatestStatus.textContent = error?.message || t('UNAVAILABLE');
      }
      if (_godseyeDrivers) _godseyeDrivers.replaceChildren();
    }
  }

  _renderLatest(feed) {
    const {
      _godseyeGoldPrice,
      _godseyeGoldChange,
      _godseyeComposite,
      _godseyeDrivers,
      _godseyeLatestStatus,
    } = this.elements;
    const gold = feed?.gold || null;
    if (_godseyeGoldPrice) {
      _godseyeGoldPrice.textContent = gold?.price ? gold.price.toFixed(2) : '—';
    }
    if (_godseyeGoldChange) {
      const change = gold?.changePct;
      _godseyeGoldChange.textContent =
        typeof change === 'number'
          ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
          : '';
      _godseyeGoldChange.classList.toggle(
        'is-up',
        typeof change === 'number' && change >= 0,
      );
      _godseyeGoldChange.classList.toggle(
        'is-down',
        typeof change === 'number' && change < 0,
      );
    }
    if (_godseyeComposite) {
      const composite = feed?.composite || {};
      const impact = Number.isFinite(composite.impact) ? composite.impact : 0;
      _godseyeComposite.textContent = `${t('RELEVANCE SCORE, NOT A CAUSE')} · ${impact} ${impactArrow(impact)}`;
    }
    if (_godseyeDrivers) {
      const drivers = Array.isArray(feed?.drivers) ? feed.drivers : [];
      if (!drivers.length) {
        const empty = this.document.createElement('li');
        empty.className = 'godseye-empty';
        empty.textContent = t('NO HEADLINES');
        _godseyeDrivers.replaceChildren(empty);
      } else {
        _godseyeDrivers.replaceChildren(
          ...drivers.map((driver) => driverRow(this.document, driver)),
        );
      }
    }
    if (_godseyeLatestStatus) {
      const news = Array.isArray(feed?.news) ? feed.news.length : 0;
      _godseyeLatestStatus.textContent = `${news} ${t('headlines')} · ${feed?.generatedAt ? new Date(feed.generatedAt).toISOString().slice(11, 16) : ''}`;
    }
  }

  /** Read the local news artifact, filtered to the chosen region. */
  async _loadNews() {
    if (this._disposed) return;
    const { _godseyeNewsRegion, _godseyeNewsList, _godseyeNewsStatus } =
      this.elements;
    const region = String(_godseyeNewsRegion?.value || 'papua');
    if (_godseyeNewsStatus) _godseyeNewsStatus.textContent = t('LOADING');
    this._newsRequest?.abort?.();
    const controller = new AbortController();
    this._newsRequest = controller;
    try {
      const response = await this._request(
        `${NEWS_ENDPOINT}?region=${encodeURIComponent(region)}&limit=${NEWS_LIMIT}`,
        { signal: controller.signal },
      );
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || `HTTP ${response.status}`);
      }
      this._renderNews(response.data);
      this._newsLoaded = true;
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyeNewsStatus) {
        _godseyeNewsStatus.textContent = error?.message || t('UNAVAILABLE');
      }
      _godseyeNewsList?.replaceChildren();
    }
  }

  _renderNews(payload) {
    const { _godseyeNewsList, _godseyeNewsStatus } = this.elements;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (_godseyeNewsList) {
      if (!items.length) {
        const empty = this.document.createElement('li');
        empty.className = 'godseye-empty';
        empty.textContent = t('NO HEADLINES');
        _godseyeNewsList.replaceChildren(empty);
      } else {
        _godseyeNewsList.replaceChildren(
          ...items.map((item) => this._newsRow(item)),
        );
      }
    }
    if (_godseyeNewsStatus) {
      const total = Number.isFinite(payload?.total)
        ? payload.total
        : items.length;
      _godseyeNewsStatus.textContent = `${items.length}/${total} ${t('headlines')}`;
    }
  }

  /** One headline: the title is the link, the source and time are the meta. */
  _newsRow(item) {
    const row = this.document.createElement('li');
    const link = this.document.createElement('a');
    link.className = 'godseye-news-item';
    if (item?.link) {
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    const title = this.document.createElement('span');
    title.className = 'godseye-news-title';
    title.textContent = item?.title || '—';
    const meta = this.document.createElement('span');
    meta.className = 'godseye-news-meta';
    const published = Number(item?.publishedAt);
    meta.textContent = [
      item?.source,
      Number.isFinite(published)
        ? new Date(published).toISOString().slice(11, 16)
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    link.append(title, meta);
    row.append(link);
    return row;
  }

  async _lookupPlace() {
    if (this._disposed) return;
    const {
      _godseyePlaceInput,
      _godseyePlaceCard,
      _godseyePlaceName,
      _godseyePlaceCoords,
      _godseyePlacePhoto,
      _godseyePlacePhotoNote,
      _godseyePlaceStatus,
      _godseyeFlyBtn,
    } = this.elements;
    const query = String(_godseyePlaceInput?.value || '').trim();
    if (!query) {
      if (_godseyePlaceStatus)
        _godseyePlaceStatus.textContent = t('ENTER A PLACE NAME');
      return;
    }
    if (_godseyePlaceStatus) _godseyePlaceStatus.textContent = t('LOADING');
    this._placeRequest?.abort?.();
    const controller = new AbortController();
    this._placeRequest = controller;
    try {
      const response = await this._request(
        `${PLACE_CARD_ENDPOINT}?query=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      );
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || `HTTP ${response.status}`);
      }
      this._renderPlace(response.data);
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyePlaceStatus) {
        _godseyePlaceStatus.textContent = error?.message || t('UNAVAILABLE');
      }
      if (_godseyePlaceCard) _godseyePlaceCard.hidden = true;
    }
  }

  _renderPlace(card) {
    const {
      _godseyePlaceCard,
      _godseyePlaceName,
      _godseyePlaceCoords,
      _godseyePlacePhoto,
      _godseyePlacePhotoNote,
      _godseyePlaceStatus,
      _godseyeFlyBtn,
    } = this.elements;
    const place = card?.place || null;
    if (!place) {
      if (_godseyePlaceStatus)
        _godseyePlaceStatus.textContent = t('UNAVAILABLE');
      return;
    }
    if (_godseyePlaceName) _godseyePlaceName.textContent = place.name || '';
    if (_godseyePlaceCoords) {
      _godseyePlaceCoords.textContent = `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
    }
    const photo = card?.photo;
    if (_godseyePlacePhoto) {
      if (photo?.url) {
        _godseyePlacePhoto.src = photo.url;
        _godseyePlacePhoto.hidden = false;
      } else {
        _godseyePlacePhoto.removeAttribute('src');
        _godseyePlacePhoto.hidden = true;
      }
    }
    if (_godseyePlacePhotoNote) {
      _godseyePlacePhotoNote.textContent = photo?.url
        ? `${t('STREET-LEVEL PHOTO')} · ${photo.provider || ''}`
        : t('NO STREET PHOTO HERE');
    }
    if (_godseyeFlyBtn) _godseyeFlyBtn.hidden = !this.flyTo;
    this._place = place;
    // A looked-up place is the point the CCTV tab wants, so it is offered there
    // rather than typed a second time.
    const cctvInput = this.elements._godseyeCctvInput;
    if (cctvInput && !String(cctvInput.value || '').trim()) {
      cctvInput.value = `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
    }
    if (_godseyePlaceCard) _godseyePlaceCard.hidden = false;
    if (_godseyePlaceStatus) _godseyePlaceStatus.textContent = '';
  }

  _scaleDetections(detections, sizes) {
    return scaleDetections(detections, sizes);
  }

  /**
   * The point the CCTV tab scans around.
   *
   * A typed coordinate pair wins; otherwise the last place card is reused, so
   * the tab answers for the place already on screen without a second lookup.
   */
  _cctvOrigin() {
    const typed = String(this.elements._godseyeCctvInput?.value || '').trim();
    const pair = typed ? parseCoordinatePair(typed) : null;
    // Text that is not a coordinate pair is a mistake, not a silent fallback:
    // scanning the previous place instead would answer a question nobody asked.
    if (typed && !pair) return { error: 'not_a_point' };
    if (pair) return pair;
    const place = this._place;
    if (place && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
      return { lat: place.lat, lon: place.lon };
    }
    return null;
  }

  /** Scan the local camera catalog around the current point. */
  async _scanCctv() {
    if (this._disposed) return;
    const { _godseyeCctvType, _godseyeCctvRadius, _godseyeCctvStatus } =
      this.elements;
    const origin = this._cctvOrigin();
    if (!origin || origin.error) {
      if (_godseyeCctvStatus) {
        _godseyeCctvStatus.textContent = t('ENTER LATITUDE AND LONGITUDE');
      }
      return;
    }
    const radiusKm = Math.min(
      Math.max(Number(_godseyeCctvRadius?.value) || 50, 1),
      500,
    );
    const type = String(_godseyeCctvType?.value || '');
    if (_godseyeCctvStatus) _godseyeCctvStatus.textContent = t('LOADING');
    this._cctvRequest?.abort?.();
    const controller = new AbortController();
    this._cctvRequest = controller;
    const params = new URLSearchParams({
      lat: String(origin.lat),
      lon: String(origin.lon),
      radiusKm: String(radiusKm),
    });
    if (type) params.set('type', type);
    try {
      const response = await this._request(`${CCTV_ENDPOINT}?${params}`, {
        signal: controller.signal,
      });
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || `HTTP ${response.status}`);
      }
      this._renderCctv(response.data);
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyeCctvStatus) {
        _godseyeCctvStatus.textContent = error?.message || t('UNAVAILABLE');
      }
      this.elements._godseyeCctvList?.replaceChildren();
    }
  }

  _renderCctv(payload) {
    const { _godseyeCctvList, _godseyeCctvStatus } = this.elements;
    const cameras = Array.isArray(payload?.inside) ? payload.inside : [];
    if (_godseyeCctvList) {
      if (!cameras.length) {
        const empty = this.document.createElement('li');
        empty.className = 'godseye-empty';
        empty.textContent = t('NO CAMERAS IN RANGE');
        _godseyeCctvList.replaceChildren(empty);
      } else {
        _godseyeCctvList.replaceChildren(
          ...cameras
            .slice(0, CCTV_LIMIT)
            .map((camera) => this._cameraRow(camera)),
        );
      }
    }
    if (_godseyeCctvStatus) {
      const shown = Math.min(cameras.length, CCTV_LIMIT);
      const radius = Number.isFinite(payload?.radiusKm) ? payload.radiusKm : 0;
      _godseyeCctvStatus.textContent = t(
        '{shown} OF {total} CAMERAS · {radius} KM',
        { shown, total: cameras.length, radius },
      );
    }
  }

  /**
   * The BTS tab: how much of each province the registry actually reaches.
   *
   * "42 sites" is not an answer; "Papua Pegunungan 4.2 % of its box" is. The
   * numbers come from the coverage route, which samples each province's extent
   * and asks the registry how near the closest site is. The same call carries
   * the terrain-aware answer (`&terrain=1`): the same sites, painted from the
   * polygons the ground allows, with a flat-earth control so the difference
   * between the two numbers is the mountains and nothing else.
   */
  async _loadBts() {
    if (this._disposed) return;
    const { _godseyeBtsList, _godseyeBtsStatus } = this.elements;
    if (_godseyeBtsStatus) _godseyeBtsStatus.textContent = t('LOADING');
    this._btsRequest?.abort?.();
    const controller = new AbortController();
    this._btsRequest = controller;
    try {
      const response = await this._request(
        `${BTS_ENDPOINT}?coverage=1&terrain=1`,
        {
          signal: controller.signal,
        },
      );
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || t('UNAVAILABLE'));
      }
      this._btsLoaded = true;
      this._renderBts(response.data);
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyeBtsStatus) {
        _godseyeBtsStatus.textContent = error?.message || t('UNAVAILABLE');
      }
      _godseyeBtsList?.replaceChildren();
    }
  }

  /**
   * The terrain answer for a typed coordinate.
   *
   * This is the one place the console stops assuming flat earth: a tower in the
   * Baliem valley sees a quarter of what a circle on the map suggests. The
   * answer names the ground height, so a 0 m reading on a 1,600 m plateau is
   * visibly "no terrain data" rather than "sea level".
   */
  async _loadViewshed() {
    if (this._disposed) return;
    const { _godseyeBtsViewshedInput, _godseyeBtsViewshed } = this.elements;
    const raw = String(_godseyeBtsViewshedInput?.value || '').trim();
    const parts = raw.split(/[,\s]+/).map(Number);
    if (parts.length < 2 || !parts.every((value) => Number.isFinite(value))) {
      if (_godseyeBtsViewshed) {
        _godseyeBtsViewshed.hidden = false;
        _godseyeBtsViewshed.replaceChildren(
          this._viewshedNote(t('ENTER A COORDINATE')),
        );
      }
      return;
    }
    const [lat, lon] = parts;
    this._viewshedRequest?.abort?.();
    const controller = new AbortController();
    this._viewshedRequest = controller;
    try {
      const response = await this._request(
        `${BTS_ENDPOINT}?viewshed=1&lat=${lat}&lon=${lon}&tech=4G&heightM=30`,
        { signal: controller.signal },
      );
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || t('UNAVAILABLE'));
      }
      this._renderViewshed(response.data, lat, lon);
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyeBtsViewshed) {
        _godseyeBtsViewshed.hidden = false;
        _godseyeBtsViewshed.replaceChildren(
          this._viewshedNote(error?.message || t('UNAVAILABLE')),
        );
      }
    }
  }

  /** One line of small print under the terrain answer. */
  _viewshedNote(text) {
    const note = this.document.createElement('p');
    note.className = 'godseye-note';
    note.textContent = text;
    return note;
  }

  _renderViewshed(payload, lat, lon) {
    const { _godseyeBtsViewshed } = this.elements;
    if (!_godseyeBtsViewshed) return;
    const rings = Array.isArray(payload?.rings) ? payload.rings : [];
    const ranges = rings.map((ring) => ring.rangeKm).sort((a, b) => a - b);
    const stats = payload?.stats || {};
    const groundM = payload?.site?.groundM;
    const capKm = payload?.profile?.capKm;
    const flat =
      ranges.length > 0 && ranges[ranges.length - 1] >= (capKm ?? 20);

    _godseyeBtsViewshed.hidden = false;
    _godseyeBtsViewshed.replaceChildren();

    const button = this.document.createElement('button');
    button.type = 'button';
    button.className = 'godseye-camera';
    button.title = `${lat}, ${lon}`;
    const name = this.document.createElement('span');
    name.className = 'godseye-camera-name';
    name.textContent = Number.isFinite(groundM)
      ? `${t('GROUND')} ${Math.round(groundM)} m`
      : t('NO TERRAIN');
    const kind = this.document.createElement('span');
    kind.className = 'godseye-camera-kind';
    kind.textContent = `${t('MEDIAN')} ${ranges.length ? ranges[Math.floor(ranges.length / 2)] : 0} km`;
    const score = this.document.createElement('span');
    score.className = 'godseye-driver-score';
    score.textContent = `${t('MAX')} ${ranges.length ? ranges[ranges.length - 1] : 0} km`;
    button.append(name, kind, score);
    button.addEventListener('click', () => this.flyToPoint?.(lat, lon, 60000));
    _godseyeBtsViewshed.append(button);

    const detail = this.document.createElement('p');
    detail.className = 'godseye-note';
    const parts = [
      `${rings.length} ${t('AZIMUTHS').toLowerCase()}`,
      `${t('MEAN')} ${stats.meanKm ?? 0} km`,
    ];
    if (flat) parts.push(t('FLAT EARTH'));
    if (payload?.tilesPrefetched) {
      parts.push(`${payload.tilesPrefetched} ${t('TILES').toLowerCase()}`);
    }
    detail.textContent = parts.join(' · ');
    _godseyeBtsViewshed.append(detail);
  }

  _renderBts(payload) {
    const { _godseyeBtsList, _godseyeBtsStatus } = this.elements;
    const provinces = Array.isArray(payload?.provinces)
      ? payload.provinces
      : [];
    // The terrain answer is a second opinion on the same grid: where it
    // exists, the province rows are ordered by what the ground allows, and the
    // flat planning percentage rides in the tooltip instead of the score.
    const terrain = payload?.terrain || null;
    const terrainRows = Array.isArray(terrain?.provinces)
      ? terrain.provinces
      : [];
    const terrainById = new Map(terrainRows.map((row) => [row.id, row]));
    const scored = provinces.map((row) => ({
      ...row,
      terrain: terrainById.get(row.id) || null,
    }));
    if (_godseyeBtsList) {
      if (!scored.length) {
        const empty = this.document.createElement('li');
        empty.className = 'godseye-empty';
        empty.textContent = t('NO BTS');
        _godseyeBtsList.replaceChildren(empty);
      } else {
        const ordered = [...scored].sort((a, b) => {
          // Terrain-aware coverage when it exists, planning circles otherwise.
          const left = a.terrain?.coveredPct ?? a.coveredPct ?? -1;
          const right = b.terrain?.coveredPct ?? b.coveredPct ?? -1;
          return right - left;
        });
        _godseyeBtsList.replaceChildren(
          ...ordered.map((row) => this._provinceRow(row)),
        );
      }
    }
    if (_godseyeBtsStatus) {
      const totals = payload?.totals || {};
      const parts = [
        `${totals.sites ?? 0} ${t('SITES')}`,
        `${t('COVERAGE')} ${totals.coveredPct ?? 0}%`,
      ];
      if (terrain && !terrain.stale) {
        parts.push(`${t('TERRAIN')} ${terrain.totals?.coveredPct ?? 0}%`);
        const delta =
          Number(terrain.totals?.controlPct) -
          Number(terrain.totals?.coveredPct);
        if (Number.isFinite(delta) && delta > 0.05) {
          parts.push(`${t('MOUNTAINS')} −${Math.round(delta * 100) / 100} pts`);
        }
      } else if (terrain?.stale) {
        // Computed before the last registry growth: still true of the sites
        // it was computed from, but not the current registry — say which.
        parts.push(
          `${t('TERRAIN')} ${terrain.totals?.coveredPct ?? 0}% (${terrain.sites}/${terrain.registrySites})`,
        );
      }
      // No terrain artifact yet: the status line keeps the planning number
      // alone rather than implying a second one exists.
      parts.push(`${t('SOURCE')} ${payload?.source || '—'}`);
      // A seed registry is a placeholder, and the status line says so.
      if (payload?.synthetic) parts.push(t('SYNTHETIC'));
      _godseyeBtsStatus.textContent = parts.join(' · ');
    }
  }

  /** One province row; clicking it flies to that province's capital. */
  _provinceRow(row) {
    const item = this.document.createElement('li');
    const button = this.document.createElement('button');
    button.type = 'button';
    button.className = 'godseye-camera';
    const terrain = row?.terrain || null;
    // The title carries both numbers so a reader can see what the ground
    // costs: the flat-earth control and the terrain viewshed, same caps.
    const titleBits = [
      `${row?.sites ?? 0} ${t('SITES')}`,
      `${t('COVERAGE')} ${row?.coveredPct ?? 0}%`,
    ];
    if (terrain && Number.isFinite(terrain.coveredPct)) {
      titleBits.push(
        `${t('TERRAIN')} ${terrain.coveredPct}% · ${t('FLAT EARTH')} ${terrain.controlPct ?? 0}%`,
      );
    }
    button.title = `${row?.name || ''} · ${titleBits.join(' · ')}`;
    const name = this.document.createElement('span');
    name.className = 'godseye-camera-name';
    name.textContent = row?.name || row?.id || '—';
    const kind = this.document.createElement('span');
    kind.className = 'godseye-camera-kind';
    kind.textContent = row?.capital || '';
    const covered = this.document.createElement('span');
    covered.className = 'godseye-driver-score';
    covered.textContent = Number.isFinite(terrain?.coveredPct)
      ? `${terrain.coveredPct}%`
      : Number.isFinite(row?.coveredPct)
        ? `${row.coveredPct}%`
        : '—';
    button.append(name, kind, covered);
    if (Number.isFinite(row?.capitalLat) && Number.isFinite(row?.capitalLon)) {
      button.addEventListener('click', () =>
        this.flyToPoint?.(row.capitalLat, row.capitalLon, 120000),
      );
    } else {
      button.disabled = true;
    }
    item.append(button);
    return item;
  }

  /** One camera row; clicking it flies the camera to that camera. */
  _cameraRow(camera) {
    const item = this.document.createElement('li');
    const button = this.document.createElement('button');
    button.type = 'button';
    button.className = 'godseye-camera';
    button.title = [camera?.city, camera?.provider].filter(Boolean).join(' · ');
    const name = this.document.createElement('span');
    name.className = 'godseye-camera-name';
    name.textContent = camera?.name || camera?.id || '—';
    const kind = this.document.createElement('span');
    kind.className = 'godseye-camera-kind';
    kind.textContent = camera?.type || '';
    const distance = this.document.createElement('span');
    distance.className = 'godseye-driver-score';
    distance.textContent = Number.isFinite(camera?.distance)
      ? `${camera.distance.toFixed(1)} km`
      : '';
    button.append(name, kind, distance);
    if (Number.isFinite(camera?.lat) && Number.isFinite(camera?.lon)) {
      button.addEventListener('click', () =>
        this.flyToPoint?.(camera.lat, camera.lon, 1200),
      );
    } else {
      button.disabled = true;
    }
    item.append(button);
    return item;
  }

  /** Resolve a target, a phone number or a cell identifier to a position. */
  async _locateTarget() {
    if (this._disposed) return;
    const {
      _godseyeLocateInput,
      _godseyeLocateCard,
      _godseyeLocateStatus,
      _godseyeLocateBasis,
    } = this.elements;
    const query = String(_godseyeLocateInput?.value || '').trim();
    if (!query) {
      if (_godseyeLocateStatus)
        _godseyeLocateStatus.textContent = t('ENTER A TARGET');
      return;
    }
    // A person-directed query has to say why it is allowed. A cell id is
    // technical, so it is the one form that does not need a basis here.
    const legalBasis = String(_godseyeLocateBasis?.value || '').trim();
    const isCell = /^\d{3}\D\d{1,3}\D\d+\D\d+$/.test(query);
    if (!legalBasis && !isCell) {
      if (_godseyeLocateStatus) {
        _godseyeLocateStatus.textContent = t('LEGAL BASIS REQUIRED');
      }
      return;
    }
    if (_godseyeLocateStatus) _godseyeLocateStatus.textContent = t('LOADING');
    this._locateRequest?.abort?.();
    const controller = new AbortController();
    this._locateRequest = controller;
    try {
      const basis = legalBasis
        ? `&legalBasis=${encodeURIComponent(legalBasis)}`
        : '';
      const response = await this._request(
        `${LOCATE_ENDPOINT}?q=${encodeURIComponent(query)}${basis}`,
        { signal: controller.signal },
      );
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || t('TARGET NOT FOUND'));
      }
      this._renderLocate(response.data);
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyeLocateStatus) {
        _godseyeLocateStatus.textContent = error?.message || t('UNAVAILABLE');
      }
      if (_godseyeLocateCard) _godseyeLocateCard.hidden = true;
      this.elements._godseyeLocateList?.replaceChildren();
      this._located = null;
    }
  }

  _renderLocate(payload) {
    const {
      _godseyeLocateCard,
      _godseyeLocateName,
      _godseyeLocateCoords,
      _godseyeLocateNote,
      _godseyeLocatePhoto,
      _godseyeLocateGround,
      _godseyeLocateList,
      _godseyeLocateStatus,
      _godseyeLocateFly,
    } = this.elements;
    const lat = Number(payload?.position?.lat ?? payload?.target?.lat);
    const lon = Number(payload?.position?.lon ?? payload?.target?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      if (_godseyeLocateStatus)
        _godseyeLocateStatus.textContent = t('UNAVAILABLE');
      if (_godseyeLocateCard) _godseyeLocateCard.hidden = true;
      this._located = null;
      return;
    }
    const isCell = payload?.mode === 'cell';
    const accuracyM = Number(payload?.accuracyM);
    const bts = payload?.bts;
    const label = isCell
      ? `${payload?.carrier?.name || t('CARRIER')} · ${payload?.cell?.cellId ?? ''}`
      : payload?.target?.name || payload?.query || '';
    if (_godseyeLocateName) _godseyeLocateName.textContent = label;
    if (_godseyeLocateCoords) {
      _godseyeLocateCoords.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
    if (_godseyeLocateNote) {
      const parts = [];
      if (isCell) {
        // How the point was obtained matters more than the point itself: a
        // tower the registry knows is not the same claim as a regional guess.
        const basis =
          payload?.positionBasis === 'known-tower'
            ? t('KNOWN TOWER')
            : payload?.positionBasis === 'provider-fix'
              ? t('MEASURED POSITION')
              : payload?.estimated
                ? t('ESTIMATED POSITION')
                : t('MEASURED POSITION');
        parts.push(basis);
        if (payload?.estimateRegion) parts.push(payload.estimateRegion);
        if (Number.isFinite(accuracyM)) {
          parts.push(`${t('ACCURACY')} ±${Math.round(accuracyM)} m`);
        }
        if (payload?.inPapua) parts.push('Papua');
      } else {
        if (payload?.matchType) {
          parts.push(`${t('MATCHED BY')} ${payload.matchType}`);
        }
        if (payload?.target?.city) parts.push(payload.target.city);
        if (payload?.target?.phone) parts.push(payload.target.phone);
      }
      // A catalogue answer is a sample, not a measurement, and the note is
      // where an operator reads first.
      if (payload?.synthetic && !isCell) parts.push(t('CATALOG'));
      if (bts?.synthetic) parts.push(t('SYNTHETIC'));
      _godseyeLocateNote.textContent = parts.join(' · ');
    }
    const rows = isCell
      ? [
          [t('CARRIER'), payload?.carrier?.name || '—'],
          [
            'MCC-MNC',
            `${payload?.cell?.mcc ?? ''}-${payload?.cell?.mnc ?? ''}`,
          ],
          ['LAC', String(payload?.cell?.lac ?? '')],
          ['CELL ID', String(payload?.cell?.cellId ?? '')],
        ]
      : [
          [t('USERNAME'), payload?.target?.username || '—'],
          [t('PHONE'), payload?.target?.phone || '—'],
          [t('CITY'), payload?.target?.city || '—'],
          [t('STATUS'), payload?.target?.status || '—'],
        ];
    // Which of the six provinces the point falls in — the answer to "where in
    // Papua", which a single island-wide label never gave.
    if (payload?.province?.name) {
      rows.push([t('PROVINCE'), payload.province.name]);
    }
    // A stored track is the time-series answer: how far the fixes have moved,
    // how fast that implies, and whether any of it is worth flagging.
    const track = payload?.track;
    if (track && Number.isFinite(track.points)) {
      const km = t('KM');
      const kmh = t('KM/H');
      rows.push([t('FIXES'), String(track.points)]);
      rows.push([t('DISTANCE'), `${track.distanceKm ?? 0} ${km}`]);
      rows.push([
        t('AVG SPEED'),
        // Two fixes taken seconds apart imply no speed worth showing.
        Number.isFinite(track.avgSpeedKmh)
          ? `${track.avgSpeedKmh} ${kmh}`
          : '—',
      ]);
      rows.push([
        t('ANOMALIES'),
        String(Array.isArray(track.anomalies) ? track.anomalies.length : 0),
      ]);
    }
    // How near the point sits to a known cell site, and how much of that
    // site's range it consumes: the honest form of "near or far".
    if (bts && Number.isFinite(bts.distanceKm)) {
      const km = t('KM');
      rows.push([
        t('NEAREST BTS'),
        `${bts.name || bts.id} · ${bts.distanceKm} ${km}`,
      ]);
      if (Number.isFinite(bts.coveragePct)) {
        rows.push([t('COVERAGE'), `${bts.coveragePct}%`]);
      }
    }
    // Where the nearest-site answer came from: an imported registry is
    // measured, the bundled seed is not, and the row says which.
    if (payload?.registry?.source) {
      rows.push([t('BTS SOURCE'), payload.registry.source]);
    }
    if (_godseyeLocateList) {
      _godseyeLocateList.replaceChildren(
        ...rows.map(([key, value]) => {
          const item = this.document.createElement('li');
          item.className = 'godseye-fact';
          const keyEl = this.document.createElement('span');
          keyEl.className = 'godseye-driver-label';
          keyEl.textContent = key;
          const valueEl = this.document.createElement('span');
          valueEl.className = 'godseye-driver-score';
          valueEl.textContent = value;
          item.append(keyEl, valueEl);
          return item;
        }),
      );
    }
    if (_godseyeLocateFly) _godseyeLocateFly.hidden = !this.flyToPoint;
    if (_godseyeLocateCard) _godseyeLocateCard.hidden = false;
    this._located = {
      lat,
      lon,
      label,
      accuracyM: Number.isFinite(accuracyM) ? accuracyM : null,
    };
    if (_godseyeLocateStatus) {
      _godseyeLocateStatus.textContent = `${t('LOCATED')} · ${t('SOURCE')} ${payload?.source || '—'}`;
    }
    // The real photograph of the point, and an independent check of the height
    // the answer stands on. Both are fetched here so the coordinate is never
    // shown alone: a number without a picture asks to be trusted, and a height
    // without a second source is only a claim.
    this._loadGround(lat, lon);
    // A located target is the answer the operator asked for, so the globe
    // turns to it immediately instead of waiting for a second click.
    this._flyToLocated();
  }

  /**
   * Put the real satellite picture and the terrain cross-check next to an
   * answer.
   *
   * Two independent calls, both allowed to fail quietly: an operator who
   * searched offline still gets the coordinate and the badge, just without the
   * photograph. What is never done is showing a picture that is not of this
   * point.
   */
  async _loadGround(lat, lon) {
    if (this._disposed) return;
    const { _godseyeLocatePhoto, _godseyeLocateGround } = this.elements;
    this._groundRequest?.abort?.();
    const controller = new AbortController();
    this._groundRequest = controller;

    // Zoom 16 is the deepest that resolves a single mast (~2.4 m per pixel)
    // without asking Esri for a tile it may not hold.
    const zoom = 16;
    try {
      const response = await this._request(
        `${VERIFY_ENDPOINT}?lat=${lat}&lon=${lon}`,
        { signal: controller.signal },
      );
      if (this._disposed) return;
      const data = response.data || {};
      if (_godseyeLocatePhoto) {
        // Only a tile that exists is shown: a broken image where the answer's
        // photograph should be is worse than no photograph.
        if (data.imagery?.available) {
          _godseyeLocatePhoto.src = `${IMAGERY_ENDPOINT}?lat=${lat}&lon=${lon}&zoom=${zoom}`;
          _godseyeLocatePhoto.hidden = false;
        } else {
          _godseyeLocatePhoto.hidden = true;
        }
      }
      if (_godseyeLocateGround) {
        const height = data.height || {};
        const ground = data.imagery?.available ? data.imagery.groundM : null;
        const parts = [];
        if (Number.isFinite(height.localM))
          parts.push(`${t('GROUND')} ${height.localM} m`);
        if (height.verdict === 'agree') parts.push(t('HEIGHT CONFIRMED'));
        else if (height.verdict === 'rough') parts.push(t('HEIGHT UNCERTAIN'));
        else if (height.verdict === 'disagree')
          parts.push(t('HEIGHT DISPUTED'));
        if (Number.isFinite(ground)) parts.push(`${ground} m/px`);
        _godseyeLocateGround.textContent = parts.join(' · ');
        _godseyeLocateGround.hidden = parts.length === 0;
      }
    } catch (error) {
      if (this._disposed || error?.name === 'AbortError') return;
      if (_godseyeLocatePhoto) _godseyeLocatePhoto.hidden = true;
      if (_godseyeLocateGround) _godseyeLocateGround.hidden = true;
    }
  }

  /** Fly the globe to the last located point, framed by its accuracy. */
  _flyToLocated(altitude) {
    if (!this._located || !this.flyToPoint) return;
    const height = Number.isFinite(altitude)
      ? altitude
      : Math.max(2500, Math.min((this._located.accuracyM || 1000) * 3, 40000));
    this.flyToPoint(this._located.lat, this._located.lon, height);
  }

  _drawDetections(rects) {
    const canvas = this.elements._godseyeVisionOverlay;
    const image = this.elements._godseyeVisionImage;
    if (!canvas || !image) return;
    const width = image.clientWidth || image.naturalWidth || 0;
    const height = image.clientHeight || image.naturalHeight || 0;
    if (!width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext?.('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.lineWidth = 2;
    for (const rect of rects) {
      context.strokeStyle = rect.kind === 'person' ? '#31e0c0' : '#ffb454';
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  async _analyseVision() {
    if (this._disposed) return;
    const {
      _godseyeVisionInput,
      _godseyeVisionFile,
      _godseyeVisionStatus,
      _godseyeVisionImage,
    } = this.elements;
    let source = String(_godseyeVisionInput?.value || '').trim();
    if (!source && _godseyeVisionFile?.files?.length) {
      const file = _godseyeVisionFile.files[0];
      source = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
    }
    if (!source) {
      if (_godseyeVisionStatus)
        _godseyeVisionStatus.textContent = t('ENTER AN IMAGE');
      return;
    }
    if (_godseyeVisionStatus) _godseyeVisionStatus.textContent = t('LOADING');
    try {
      const response = await this._request(VISION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: source, scene: true }),
      });
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || `HTTP ${response.status}`);
      }
      // Pass the last known place coordinates as the footprint anchor.
      // If the user has not looked up a place yet, we fall back to a
      // zero footprint (no polygons drawn, only the 2D overlay on the photo).
      const place = this._place || null;
      const footprint =
        place && Number.isFinite(place.lat) && Number.isFinite(place.lon)
          ? { lat: place.lat, lon: place.lon, widthM: 40, heightM: 40 }
          : null;
      this._renderVision(response.data?.detections || {}, source, footprint);
    } catch (error) {
      if (this._disposed) return;
      if (_godseyeVisionStatus) {
        _godseyeVisionStatus.textContent = error?.message || t('UNAVAILABLE');
      }
    }
  }

  _renderVision(detections, imageSource, footprint = null) {
    const {
      _godseyeVisionImage,
      _godseyeVisionList,
      _godseyeVisionStage,
      _godseyeVisionStatus,
    } = this.elements;

    // Build flat list of detections with their original indices
    const allDetections = [];
    for (const person of detections?.people || []) {
      allDetections.push({ ...person, kind: 'person' });
    }
    for (const vehicle of detections?.vehicles || []) {
      allDetections.push({ ...vehicle, kind: 'vehicle' });
    }

    // Draw polygons on globe via vision-bbox layer (dynamic import to avoid
    // Cesium in test environment).
    if (allDetections.length > 0 && footprint) {
      // Convert detections to layer format
      const layerDetections = allDetections.map((d, i) => ({
        kind: d.kind,
        box: Array.isArray(d.bbox) ? d.bbox : [0, 0, 0, 0],
        confidence: d.confidence || 0,
        index: i,
      }));
      (async () => {
        try {
          const { drawVisionDetections } =
            await import('../app/layers/vision-bbox.js');
          drawVisionDetections(layerDetections, footprint);
        } catch (_e) {
          // vision-bbox unavailable in test env; ignore.
        }
      })();
    } else {
      (async () => {
        try {
          const { clearVisionDetections } =
            await import('../app/layers/vision-bbox.js');
          clearVisionDetections();
        } catch (_e) {
          // ignore in test env
        }
      })();
    }

    if (_godseyeVisionImage) {
      _godseyeVisionImage.src = imageSource;
      _godseyeVisionImage.hidden = false;
      _godseyeVisionImage.onload = () => {
        const rects = this._scaleDetections(detections, {
          naturalWidth: _godseyeVisionImage.naturalWidth,
          naturalHeight: _godseyeVisionImage.naturalHeight,
          viewWidth: _godseyeVisionImage.clientWidth,
          viewHeight: _godseyeVisionImage.clientHeight,
        });
        this._drawDetections(rects);
      };
    }
    if (_godseyeVisionStage) _godseyeVisionStage.hidden = false;
    const rows = [];
    for (const person of detections?.people || []) {
      const holding = Array.isArray(person?.holding)
        ? person.holding.join(', ')
        : '';
      const detail = holding
        ? `${person?.activity || '—'} · ${holding}`
        : person?.activity || '—';
      rows.push({ kind: t('PERSON'), detail, confidence: person?.confidence });
    }
    for (const vehicle of detections?.vehicles || []) {
      rows.push({
        kind: t('VEHICLE'),
        detail: vehicle?.type || '—',
        confidence: vehicle?.confidence,
      });
    }
    if (_godseyeVisionList) {
      if (!rows.length) {
        const empty = this.document.createElement('li');
        empty.className = 'godseye-empty';
        empty.textContent = t('NO DETECTIONS');
        _godseyeVisionList.replaceChildren(empty);
      } else {
        _godseyeVisionList.replaceChildren(
          ...rows.map((row, index) => {
            const item = this.document.createElement('li');
            item.className = 'godseye-vision-row';
            const kind = this.document.createElement('span');
            kind.className = 'godseye-driver-label';
            kind.textContent = row.kind;
            const detail = this.document.createElement('span');
            detail.className = 'godseye-driver-label';
            detail.textContent = row.detail;
            const score = this.document.createElement('span');
            score.className = 'godseye-driver-score';
            score.textContent = Number.isFinite(row.confidence)
              ? row.confidence.toFixed(2)
              : '—';
            const flyBtn = this.document.createElement('button');
            flyBtn.type = 'button';
            flyBtn.className = 'godseye-fly-btn';
            flyBtn.textContent = t('FLY');
            flyBtn.title = t('Fly to detection');
            flyBtn.addEventListener('click', async () => {
              try {
                const { flyToVisionDetection } =
                  await import('../app/layers/vision-bbox.js');
                flyToVisionDetection(index);
              } catch (_e) {
                // unavailable in test env
              }
            });
            item.append(kind, detail, score, flyBtn);
            return item;
          }),
        );
      }
    }
    if (_godseyeVisionStatus) {
      const people = detections?.people?.length || 0;
      const vehicles = detections?.vehicles?.length || 0;
      _godseyeVisionStatus.textContent = detections?.parsed
        ? `${people} ${t('PEOPLE')} · ${vehicles} ${t('VEHICLES')}`
        : detections?.notes || t('NO DETECTIONS');
    }
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
