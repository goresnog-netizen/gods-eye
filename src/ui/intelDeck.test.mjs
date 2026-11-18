import assert from 'node:assert/strict';
import test from 'node:test';

import { initIntelDeck } from './intelDeck.js';

/** A tiny element: the deck only uses these members. */
function makeElement(tag = 'div') {
  const classes = new Set();
  const element = {
    tag,
    textContent: '',
    hidden: false,
    src: '',
    value: '',
    href: '',
    title: '',
    dataset: {},
    children: [],
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name),
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    append(...nodes) {
      element.children.push(...nodes);
    },
    appendChild(node) {
      element.children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      element.children = nodes;
    },
    focus() {},
    querySelectorAll: () => [],
  };
  return element;
}

const IDS = [
  'intel-deck',
  'deck-clock',
  'deck-collapse',
  'deck-news-cards',
  'deck-news-count',
  'deck-news-status',
  'deck-cctv-country',
  'deck-cctv-region',
  'deck-cctv-search',
  'deck-cctv-frame',
  'deck-cctv-empty',
  'deck-cctv-label',
  'deck-cctv-grid',
  'deck-cctv-count',
  'deck-cctv-status',
  'deck-wire-list',
  'deck-wire-count',
  'deck-wire-status',
  'deck-papua-card',
  'deck-papua-count',
  'deck-reader',
  'deck-reader-kicker',
  'deck-reader-title',
  'deck-reader-meta',
  'deck-reader-snippet',
  'deck-reader-list',
  'deck-reader-tabs',
  'deck-reader-tab-domestic',
  'deck-reader-tab-foreign',
  'deck-reader-link',
  'deck-reader-close',
];

function makeDocument() {
  const nodes = new Map(IDS.map((id) => [id, makeElement()]));
  const body = makeElement('body');
  return {
    body,
    hidden: false,
    activeElement: null,
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
    removeEventListener() {},
    nodes,
  };
}

const NEWS = {
  ok: true,
  live: true,
  total: 144,
  items: [
    { title: 'KKB Yahukimo', outlet: 'Kompas.com', publishedAt: Date.now() - 60000 },
    { title: 'Banjir Sentani', outlet: 'Antara', publishedAt: Date.now() - 3600000 },
  ],
};

const WIRE = {
  ok: true,
  live: true,
  items: [
    { title: 'Nvidia chip case', outlet: 'Bloomberg', publishedAt: Date.now() - 120000 },
    { title: 'Czech media rally', outlet: 'Reuters', publishedAt: Date.now() - 600000 },
  ],
};

const REGIONS = {
  total: 4000,
  countries: [
    { id: 'us', country: 'United States', count: 1180 },
    { id: 'id', country: 'Indonesia', count: 117 },
  ],
  regions: [
    { id: 'us-tx', countryId: 'us', country: 'United States', region: 'Texas', count: 572 },
    { id: 'id-id', countryId: 'id', country: 'Indonesia', region: 'Indonesia', count: 117 },
  ],
};

const SOURCES = {
  sources: [
    { id: 'c1', name: 'Simpang Parman', city: 'Banjarmasin' },
    { id: 'c2', name: 'Jayapura Kota', city: 'Jayapura' },
  ],
};

/** Route the four endpoints the deck asks for. */
function fakeFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    const body = String(url).includes('/api/cctv/regions')
      ? REGIONS
      : String(url).includes('/api/cctv/sources')
        ? SOURCES
        : String(url).includes('/api/godseye/wire')
          ? WIRE
          : NEWS;
    return { ok: true, status: 200, json: async () => body };
  };
}

async function settle() {
  // Microtasks for the awaits, macrotasks for the deferred wire load.
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('the deck renders headlines, the wire and camera tiles', async () => {
  const doc = makeDocument();
  const calls = [];
  const dispose = initIntelDeck({ document: doc, fetchImpl: fakeFetch(calls), intervalMs: 60000, wireDelayMs: 0 });
  await settle();

  const cards = doc.getElementById('deck-news-cards').children;
  assert.equal(cards.length, 2);
  assert.equal(cards[0].children[0].textContent, 'KKB Yahukimo');
  assert.match(doc.getElementById('deck-news-status').textContent, /LIVE/);

  const wire = doc.getElementById('deck-wire-list').children;
  assert.equal(wire.length, 2);
  assert.equal(wire[0].children[0].children[0].children[0].textContent, 'Bloomberg');

  const cams = doc.getElementById('deck-cctv-grid').children;
  assert.equal(cams.length, 2);
  assert.match(cams[0].children[0].src, /\/api\/cctv\/frame\/c1/);

  // Country and region selectors are filled from the region index.
  const countries = doc.getElementById('deck-cctv-country').children;
  assert.equal(countries.length, 3, 'all-countries option plus two countries');
  assert.equal(countries[1].textContent, 'United States (1180)');

  assert.ok(calls.some((url) => url.includes('live=1&region=papua')));
  assert.ok(calls.some((url) => url.includes('/api/godseye/wire')));
  assert.ok(doc.body.classList.contains('has-deck'));
  dispose();
  assert.equal(doc.body.classList.contains('has-deck'), false);
});

test('a failing endpoint leaves the other columns working', async () => {
  const doc = makeDocument();
  const dispose = initIntelDeck({
    document: doc,
    fetchImpl: async (url) => {
      if (String(url).includes('/api/godseye/wire')) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      const body = String(url).includes('/api/cctv')
        ? SOURCES
        : NEWS;
      return { ok: true, status: 200, json: async () => body };
    },
    intervalMs: 60000,
    wireDelayMs: 0,
  });
  await settle();

  assert.equal(doc.getElementById('deck-news-cards').children.length, 2);
  assert.equal(doc.getElementById('deck-wire-list').children.length, 0);
  assert.match(doc.getElementById('deck-wire-status').textContent, /503/);
  dispose();
});

test('the deck does nothing when the markup is absent', () => {
  const doc = { getElementById: () => null, body: null };
  const dispose = initIntelDeck({ document: doc });
  assert.equal(typeof dispose, 'function');
  dispose();
});
