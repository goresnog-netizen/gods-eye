/**
 * INTEL DECK — the band under the globe.
 *
 * Three columns, one job each:
 *   left    every headline as a small card; a card opens the reader
 *   centre  live cameras, filtered by country, region or a free-text query
 *   right   the outlet wire, newest first, with the Papua watch card on top
 *
 * The module owns its own DOM (ids prefixed `deck-`) so it never depends on the
 * shell's element table, and it returns a cleanup function the shell can call
 * when the application tears down.
 */
import { t } from '../i18n/index.js';

const NEWS_ENDPOINT = '/api/godseye/news';
const WIRE_ENDPOINT = '/api/godseye/wire';
const REGIONS_ENDPOINT = '/api/cctv/regions';
const SOURCES_ENDPOINT = '/api/cctv/sources';

const NEWS_LIMIT = 12;
const WIRE_LIMIT = 36;
const CAMERA_TILES = 10;
const REFRESH_MS = 60 * 1000;

/** `HH:MM` in the reader's own timezone, or an empty string for bad input. */
function clockOf(value) {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  const date = new Date(stamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function relativeAge(value) {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  const minutes = Math.max(0, Math.round((Date.now() - stamp) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Build one column of the deck.
 * @param {{document?: Document, fetchImpl?: typeof fetch, intervalMs?: number}} [options]
 * @returns {() => void} cleanup
 */
export function initIntelDeck({
  document: doc = globalThis.document,
  fetchImpl = (...args) => fetch(...args),
  intervalMs = REFRESH_MS,
  wireDelayMs = 1200,
} = {}) {
  const root = doc?.getElementById?.('intel-deck');
  if (!root) return () => {};

  const el = (id) => doc.getElementById(id);
  const body = doc.body;

  const nodes = {
    clock: el('deck-clock'),
    collapse: el('deck-collapse'),
    cards: el('deck-news-cards'),
    newsCount: el('deck-news-count'),
    newsStatus: el('deck-news-status'),
    country: el('deck-cctv-country'),
    region: el('deck-cctv-region'),
    search: el('deck-cctv-search'),
    frame: el('deck-cctv-frame'),
    empty: el('deck-cctv-empty'),
    camLabel: el('deck-cctv-label'),
    cctvGrid: el('deck-cctv-grid'),
    cctvCount: el('deck-cctv-count'),
    cctvStatus: el('deck-cctv-status'),
    wire: el('deck-wire-list'),
    wireCount: el('deck-wire-count'),
    wireStatus: el('deck-wire-status'),
    papua: el('deck-papua-card'),
    papuaCount: el('deck-papua-count'),
    reader: el('deck-reader'),
    readerKicker: el('deck-reader-kicker'),
    readerTitle: el('deck-reader-title'),
    readerMeta: el('deck-reader-meta'),
    readerSnippet: el('deck-reader-snippet'),
    readerList: el('deck-reader-list'),
    readerTabs: el('deck-reader-tabs'),
    readerDomestic: el('deck-reader-tab-domestic'),
    readerForeign: el('deck-reader-tab-foreign'),
    readerLink: el('deck-reader-link'),
    readerClose: el('deck-reader-close'),
  };

  let disposed = false;
  let refreshTimer = null;
  let clockTimer = null;
  let lastFocused = null;
  let papuaScope = 'domestic';
  let cachedRegions = [];

  body?.classList?.add('has-deck');

  /** Ask the server for JSON and keep a readable failure message. */
  /**
   * Ask the server for JSON.
   *
   * The 30 s ceiling exists because a stalled upstream otherwise leaves a
   * column saying LOADING forever, which reads as a broken panel rather than a
   * slow source.
   */
  async function readJson(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(t('TIMED OUT'));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Reader ────────────────────────────────────────────────────────────────

  function openReader({ kicker, title, meta, snippet, link }) {
    if (!nodes.reader) return;
    lastFocused = doc.activeElement;
    nodes.readerKicker.textContent = kicker || '';
    nodes.readerTitle.textContent = title || '';
    nodes.readerMeta.textContent = meta || '';
    nodes.readerSnippet.textContent = snippet || '';
    nodes.readerSnippet.hidden = false;
    nodes.readerList.hidden = true;
    nodes.readerTabs.hidden = true;
    if (link) {
      nodes.readerLink.href = link;
      nodes.readerLink.hidden = false;
    } else {
      nodes.readerLink.hidden = true;
      nodes.readerLink.removeAttribute('href');
    }
    nodes.reader.hidden = false;
    nodes.readerClose?.focus?.();
  }

  function closeReader() {
    if (!nodes.reader) return;
    nodes.reader.hidden = true;
    nodes.readerList?.replaceChildren?.();
    lastFocused?.focus?.();
  }

  function openHeadline(item) {
    const outlet = item?.outlet || item?.source || '';
    const age = relativeAge(item?.publishedAt);
    openReader({
      kicker: outlet,
      title: item?.title || '',
      meta: [outlet, clockOf(item?.publishedAt), age ? `${age} ${t('AGO')}` : '']
        .filter(Boolean)
        .join(' · '),
      snippet:
        item?.snippet ||
        t('No summary from this source. Open it to read the full story.'),
      link: item?.link || '',
    });
  }

  /** Render a list of headlines inside the reader (Papua watch). */
  function renderReaderList(items) {
    if (!nodes.readerList) return;
    const rows = (items || []).slice(0, 40).map((item) => {
      const li = doc.createElement('li');
      const link = doc.createElement('a');
      link.href = item?.link || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item?.title || '';
      const meta = doc.createElement('span');
      meta.textContent = [
        item?.outlet || item?.source || '',
        clockOf(item?.publishedAt),
      ]
        .filter(Boolean)
        .join(' · ');
      li.append(link, meta);
      return li;
    });
    if (!rows.length) {
      const li = doc.createElement('li');
      li.textContent = t('No headlines right now.');
      rows.push(li);
    }
    nodes.readerList.replaceChildren(...rows);
  }

  async function loadPapua(scope) {
    papuaScope = scope;
    nodes.readerDomestic?.classList.toggle('is-active', scope === 'domestic');
    nodes.readerForeign?.classList.toggle('is-active', scope === 'foreign');
    if (nodes.readerList) {
      nodes.readerList.hidden = false;
      nodes.readerList.replaceChildren();
    }
    try {
      const data = await readJson(
        `${NEWS_ENDPOINT}?live=1&region=papua&scope=${scope === 'foreign' ? 'international' : 'domestic'}&limit=40`,
      );
      if (disposed) return;
      renderReaderList(data?.items);
    } catch {
      renderReaderList([]);
    }
  }

  function openPapua() {
    if (!nodes.reader) return;
    lastFocused = doc.activeElement;
    nodes.readerKicker.textContent = t('PAPUA WATCH');
    nodes.readerTitle.textContent = t('Papua: rights, aid and displacement');
    nodes.readerMeta.textContent = t('Domestic and foreign coverage, newest first');
    nodes.readerSnippet.hidden = true;
    nodes.readerLink.hidden = true;
    nodes.readerTabs.hidden = false;
    nodes.readerList.hidden = false;
    nodes.reader.hidden = false;
    nodes.readerClose?.focus?.();
    void loadPapua(papuaScope);
  }

  // ── Columns ───────────────────────────────────────────────────────────────

  function renderNews(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (nodes.newsCount) nodes.newsCount.textContent = String(items.length);
    if (nodes.newsStatus) {
      nodes.newsStatus.textContent = payload?.live
        ? `${t('LIVE')} · ${clockOf(Date.now())}`
        : t('CACHED');
    }
    if (!nodes.cards) return;
    if (!items.length) {
      nodes.cards.replaceChildren();
      return;
    }
    nodes.cards.replaceChildren(
      ...items.slice(0, NEWS_LIMIT).map((item) => {
        const card = doc.createElement('button');
        card.type = 'button';
        card.className = 'deck-card';
        const title = doc.createElement('span');
        title.className = 'deck-card-title';
        title.textContent = item?.title || '';
        const meta = doc.createElement('span');
        meta.className = 'deck-card-meta';
        meta.textContent = [
          item?.outlet || item?.source || '',
          relativeAge(item?.publishedAt),
        ]
          .filter(Boolean)
          .join(' · ');
        card.append(title, meta);
        card.addEventListener('click', () => openHeadline(item));
        return card;
      }),
    );
  }

  function renderWire(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (nodes.wireCount) nodes.wireCount.textContent = String(items.length);
    if (nodes.wireStatus) {
      nodes.wireStatus.textContent = payload?.live
        ? `${t('LIVE')} · ${clockOf(Date.now())}`
        : t('CACHED');
    }
    if (!nodes.wire) return;
    if (!items.length) {
      nodes.wire.replaceChildren();
      return;
    }
    nodes.wire.replaceChildren(
      ...items.slice(0, WIRE_LIMIT).map((item) => {
        const row = doc.createElement('li');
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'deck-wire-item';
        const top = doc.createElement('span');
        top.className = 'deck-wire-top';
        const outlet = doc.createElement('span');
        outlet.className = 'deck-wire-outlet';
        outlet.textContent = item?.outlet || item?.source || '';
        const time = doc.createElement('span');
        time.className = 'deck-wire-time';
        time.textContent = relativeAge(item?.publishedAt);
        top.append(outlet, time);
        const title = doc.createElement('span');
        title.className = 'deck-wire-title';
        title.textContent = item?.title || '';
        button.append(top, title);
        button.addEventListener('click', () => openHeadline(item));
        row.append(button);
        return row;
      }),
    );
  }

  async function loadNews() {
    try {
      const data = await readJson(
        `${NEWS_ENDPOINT}?live=1&region=papua&scope=all&limit=${NEWS_LIMIT}`,
      );
      if (disposed) return;
      renderNews(data);
      if (nodes.papuaCount) {
        nodes.papuaCount.textContent = String(Number(data?.total) || 0);
      }
    } catch (error) {
      if (disposed) return;
      if (nodes.newsStatus) nodes.newsStatus.textContent = error?.message || '';
    }
  }

  async function loadWire() {
    try {
      const data = await readJson(`${WIRE_ENDPOINT}?limit=${WIRE_LIMIT}`);
      if (disposed) return;
      renderWire(data);
    } catch (error) {
      if (disposed) return;
      if (nodes.wireStatus) nodes.wireStatus.textContent = error?.message || '';
    }
  }

  // ── Cameras ───────────────────────────────────────────────────────────────

  function fillSelect(select, entries, allLabel) {
    if (!select) return;
    const options = [allLabel, ...entries].map((entry) => {
      const option = doc.createElement('option');
      option.value = entry.value ?? '';
      option.textContent = entry.label ?? '';
      return option;
    });
    select.replaceChildren(...options);
  }

  async function loadRegions() {
    try {
      let data = await readJson(REGIONS_ENDPOINT);
      // The camera catalog is assembled lazily on a cold server, so the first
      // answer can be a fraction of the registry. Ask once more before drawing
      // a country list that is missing half the world.
      if (Number(data?.total) < 500) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (disposed) return;
        const retry = await readJson(REGIONS_ENDPOINT).catch(() => null);
        if (Number(retry?.total) > Number(data?.total)) data = retry;
      }
      if (disposed) return;
      cachedRegions = Array.isArray(data?.regions) ? data.regions : [];
      fillSelect(
        nodes.country,
        (data?.countries || []).map((country) => ({
          value: country.id,
          label: `${country.country} (${country.count})`,
        })),
        { value: '', label: t('ALL COUNTRIES') },
      );
      fillSelect(nodes.region, [], { value: '', label: t('ALL REGIONS') });
      applyRegionsForCountry();
    } catch {
      // The selectors stay empty; the free-text search still works.
    }
  }

  function applyRegionsForCountry() {
    const countryId = nodes.country?.value || '';
    if (!nodes.region) return;
    if (!countryId) {
      fillSelect(nodes.region, [], { value: '', label: t('ALL REGIONS') });
      return;
    }
    const regions = cachedRegions
      .filter((region) => region.countryId === countryId)
      .map((region) => ({
        value: region.id,
        label: `${region.region} (${region.count})`,
      }));
    fillSelect(nodes.region, regions, { value: '', label: t('ALL REGIONS') });
  }

  function renderCameras(sources) {
    const list = Array.isArray(sources) ? sources : [];
    if (nodes.cctvCount) nodes.cctvCount.textContent = String(list.length);
    if (nodes.cctvStatus) {
      const shown = Math.min(list.length, CAMERA_TILES);
      nodes.cctvStatus.textContent = `${shown} / ${list.length} ${t('CAMERAS')}`;
    }
    if (!nodes.cctvGrid) return;
    nodes.cctvGrid.replaceChildren(
      ...list.slice(0, CAMERA_TILES).map((camera) => {
        const tile = doc.createElement('button');
        tile.type = 'button';
        tile.className = 'deck-cam';
        tile.dataset.cameraId = camera?.id || '';
        tile.title = [camera?.name, camera?.city].filter(Boolean).join(' · ');
        const image = doc.createElement('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = `/api/cctv/frame/${encodeURIComponent(camera?.id || '')}`;
        const label = doc.createElement('span');
        label.textContent = camera?.city || camera?.name || '';
        tile.append(image, label);
        tile.addEventListener('click', () => selectCamera(camera, tile));
        return tile;
      }),
    );
    // Put the first camera on screen straight away: the centre column is the
    // live view, not a chooser.
    const first = nodes.cctvGrid.firstElementChild;
    if (first && list[0]) selectCamera(list[0], first);
  }

  function selectCamera(camera, tile) {
    if (!nodes.frame || !camera?.id) return;
    nodes.frame.src = `/api/cctv/frame/${encodeURIComponent(camera.id)}`;
    nodes.frame.hidden = false;
    if (nodes.empty) nodes.empty.hidden = true;
    if (nodes.camLabel) {
      nodes.camLabel.textContent = [camera.name, camera.city]
        .filter(Boolean)
        .join(' · ');
    }
    for (const other of nodes.cctvGrid?.children || []) {
      other.classList?.toggle?.('is-active', other === tile);
    }
  }

  async function loadCameras() {
    const region = nodes.region?.value || nodes.country?.value || '';
    const query = String(nodes.search?.value || '').trim();
    try {
      const params = new URLSearchParams();
      if (region) params.set('region', region);
      if (query) params.set('q', query);
      const data = await readJson(
        `${SOURCES_ENDPOINT}${params.toString() ? `?${params}` : ''}`,
      );
      if (disposed) return;
      renderCameras(data?.sources);
    } catch (error) {
      if (disposed) return;
      if (nodes.cctvStatus) nodes.cctvStatus.textContent = error?.message || '';
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  const onCollapse = () => {
    const collapsed = body?.classList?.toggle('deck-collapsed');
    nodes.collapse?.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) void loadCameras();
  };

  const onCountry = () => {
    applyRegionsForCountry();
    void loadCameras();
  };

  const onSearch = (() => {
    let handle = 0;
    return () => {
      clearTimeout(handle);
      handle = setTimeout(() => void loadCameras(), 320);
    };
  })();

  const onReaderClick = (event) => {
    if (event.target === nodes.reader) closeReader();
  };

  const onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    if (!nodes.reader?.hidden) closeReader();
  };

  nodes.collapse?.addEventListener('click', onCollapse);
  nodes.country?.addEventListener('change', onCountry);
  nodes.region?.addEventListener('change', () => void loadCameras());
  nodes.search?.addEventListener('input', onSearch);
  nodes.readerClose?.addEventListener('click', closeReader);
  nodes.reader?.addEventListener('click', onReaderClick);
  nodes.readerDomestic?.addEventListener('click', () => void loadPapua('domestic'));
  nodes.readerForeign?.addEventListener('click', () => void loadPapua('foreign'));
  nodes.papua?.addEventListener('click', openPapua);
  doc.addEventListener('keydown', onKeydown);

  const tickClock = () => {
    if (nodes.clock) {
      nodes.clock.textContent = new Date().toISOString().slice(11, 19);
    }
  };
  tickClock();
  clockTimer = setInterval(tickClock, 1000);
  clockTimer?.unref?.();

  if (nodes.newsStatus) nodes.newsStatus.textContent = t('LOADING');
  if (nodes.wireStatus) nodes.wireStatus.textContent = t('LOADING');
  if (nodes.cctvStatus) nodes.cctvStatus.textContent = t('LOADING');

  void loadNews();
  // Staggered: the news feed and the wire are 26 and 12 Google News queries on
  // the server, and firing both at once doubles the wait for the first paint.
  setTimeout(() => {
    if (!disposed) void loadWire();
  }, wireDelayMs);
  void loadRegions().then(() => loadCameras());

  refreshTimer = setInterval(() => {
    if (disposed || doc.hidden) return;
    void loadNews();
    void loadWire();
  }, intervalMs);
  refreshTimer?.unref?.();

  return () => {
    disposed = true;
    clearInterval(refreshTimer);
    clearInterval(clockTimer);
    nodes.collapse?.removeEventListener('click', onCollapse);
    nodes.country?.removeEventListener('change', onCountry);
    nodes.search?.removeEventListener('input', onSearch);
    nodes.readerClose?.removeEventListener('click', closeReader);
    nodes.reader?.removeEventListener('click', onReaderClick);
    nodes.papua?.removeEventListener('click', openPapua);
    doc.removeEventListener('keydown', onKeydown);
    body?.classList?.remove('has-deck', 'deck-collapsed');
  };
}
