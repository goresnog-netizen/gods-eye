import assert from 'node:assert/strict';
import test from 'node:test';

import { GodsEyeTarget } from './godseyeTarget.js';
import { railFixture } from './railTestFixture.mjs';

const PROFILE = {
  target: 'Madrid',
  radiusKm: 25,
  position: {
    status: 'ok',
    name: 'Madrid, Community of Madrid, Spain',
    lat: 40.41678,
    lon: -3.70351,
    radiusKm: 25,
    bbox: { south: 40.13, west: -3.99, north: 40.7, east: -3.41 },
  },
  involvement: {
    status: 'ok',
    engine: 'fallback',
    total: 3,
    bySource: [
      { source: 'Example', count: 2 },
      { source: 'Another', count: 1 },
    ],
    top: [
      {
        title: 'Madrid council approves a new plan',
        url: 'https://example.org/one',
        source: 'Example',
        publishedAt: Date.parse('2026-10-22T01:00:00Z'),
      },
      {
        title: 'Madrid housing market slows',
        url: 'https://example.org/two',
        source: 'Example',
        publishedAt: Date.parse('2026-10-21T01:00:00Z'),
      },
    ],
    summary: '3 results from 2 sources',
    note: 'the local instance is unreachable',
  },
  nearby: {
    status: 'ok',
    radiusKm: 25,
    total: 2,
    items: [
      {
        id: 1,
        type: 'node',
        name: 'Puerta del Sol',
        kind: 'amenity',
        lat: 40.41678,
        lon: -3.70351,
        distanceKm: 0,
      },
      {
        id: 2,
        type: 'way',
        name: 'Casa de Campo',
        kind: 'amenity',
        lat: 40.42,
        lon: -3.7,
        distanceKm: 0.44,
      },
    ],
    kinds: [{ kind: 'amenity', count: 2 }],
  },
  generatedAt: Date.parse('2026-10-22T09:00:00Z'),
  sources: [
    { name: 'nominatim', ok: true, detail: 'geocoded' },
    { name: 'search', ok: true, detail: 'answered' },
    { name: 'overpass', ok: true, detail: '2 named entities' },
  ],
};

function fixture({ profile = PROFILE, fail = null } = {}) {
  const f = railFixture();
  const element = () => f.document.createElement('div');
  const elements = {
    _godseyeTargetInput: f.document.createElement('input'),
    _godseyeTargetBtn: f.document.createElement('button'),
    _godseyeTargetRadius: f.document.createElement('input'),
    _godseyeTargetHint: f.document.createElement('input'),
    _godseyePresetIndonesia: f.document.createElement('button'),
    _godseyePresetPapua: f.document.createElement('button'),
    _godseyeTargetStatus: element(),
    _godseyeTargetPosition: element(),
    _godseyeTargetInvolvement: element(),
    _godseyeTargetNearby: element(),
  };
  const requests = [];
  const services = {
    godseye: {
      async raw(endpoint) {
        requests.push(endpoint);
        if (fail) return { ok: false, status: fail.status, data: fail.data };
        return { ok: true, status: 200, data: profile };
      },
    },
  };
  return {
    ...f,
    elements,
    requests,
    services,
    panel: new GodsEyeTarget({
      elements,
      services,
      document: f.document,
    }),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the panel fills the three blocks from the profile', async () => {
  const f = fixture();
  f.panel.connect();
  f.elements._godseyeTargetInput.value = 'Madrid';
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.equal(f.requests.length, 1);
  assert.match(
    f.requests[0],
    /^\/api\/godseye\/target\?target=Madrid&radiusKm=25$/,
  );

  const position = f.elements._godseyeTargetPosition;
  assert.equal(
    position.children[0].textContent,
    'Madrid, Community of Madrid, Spain',
  );
  assert.equal(position.children[1].textContent, '40.41678, -3.70351');
  assert.equal(position.children[2].textContent, '25 km');

  const involvement = f.elements._godseyeTargetInvolvement;
  assert.equal(involvement.children[0].textContent, '3 results from 2 sources');
  const list = involvement.children[1];
  assert.equal(list.tagName, 'UL');
  assert.equal(list.children.length, 4);
  assert.equal(list.children[0].children[0].textContent, 'Example');
  assert.equal(list.children[0].children[1].textContent, '2');
  assert.equal(list.children[1].children[0].textContent, 'Another');
  assert.equal(list.children[1].children[1].textContent, '1');
  assert.equal(
    list.children[2].children[0].textContent,
    'Madrid council approves a new plan',
  );
  assert.match(list.children[2].children[1].textContent, /2026-10-22/);

  const nearby = f.elements._godseyeTargetNearby;
  const nearbyList = nearby.children[0];
  assert.equal(nearbyList.tagName, 'UL');
  assert.equal(nearbyList.children.length, 2);
  assert.equal(
    nearbyList.children[0].children[0].textContent,
    'Puerta del Sol',
  );
  assert.equal(nearbyList.children[0].children[1].textContent, 'amenity');
  assert.equal(nearbyList.children[0].children[2].textContent, '0.00 km');
  assert.equal(nearbyList.children[1].children[2].textContent, '0.44 km');

  assert.equal(f.elements._godseyeTargetStatus.textContent, '');
});

test('the radius the operator asks for travels with the request', async () => {
  const f = fixture();
  f.panel.connect();
  f.elements._godseyeTargetInput.value = 'Madrid';
  f.elements._godseyeTargetRadius.value = '40';
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.match(f.requests[0], /radiusKm=40$/);
});

test('a region hint travels with the request', async () => {
  const f = fixture();
  f.panel.connect();
  f.elements._godseyeTargetInput.value = 'Merauke';
  f.elements._godseyeTargetHint.value = 'Papua, Indonesia';
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.match(f.requests[0], /hint=Papua%2C%20Indonesia/);
});

test('a region preset fills the hint and a radius that suits the place', () => {
  const f = fixture();
  f.panel.connect();
  f.elements._godseyePresetPapua.dispatchEvent(new Event('click'));
  assert.equal(f.elements._godseyeTargetHint.value, 'Papua, Indonesia');
  assert.equal(f.elements._godseyeTargetRadius.value, '100');

  f.elements._godseyePresetIndonesia.dispatchEvent(new Event('click'));
  assert.equal(f.elements._godseyeTargetHint.value, 'Indonesia');
  assert.equal(f.elements._godseyeTargetRadius.value, '50');
});

test('an empty target asks for a name and calls nothing', async () => {
  const f = fixture();
  f.panel.connect();
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.equal(f.requests.length, 0);
  assert.equal(
    f.elements._godseyeTargetStatus.textContent,
    'ENTER A TARGET NAME',
  );
});

test('a failed request shows the reason and clears the blocks', async () => {
  const f = fixture({
    fail: { status: 502, data: { detail: 'the target could not be built' } },
  });
  f.panel.connect();
  f.elements._godseyeTargetInput.value = 'Madrid';
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.equal(
    f.elements._godseyeTargetStatus.textContent,
    'the target could not be built',
  );
  assert.equal(f.elements._godseyeTargetPosition.children.length, 0);
  assert.equal(f.elements._godseyeTargetInvolvement.children.length, 0);
  assert.equal(f.elements._godseyeTargetNearby.children.length, 0);
});

test('an empty answer says so instead of showing nothing', async () => {
  const f = fixture({
    profile: {
      ...PROFILE,
      involvement: {
        status: 'empty',
        engine: 'searxng',
        total: 0,
        bySource: [],
        top: [],
        summary: 'no digital trace was found',
        note: '',
      },
      nearby: {
        status: 'empty',
        radiusKm: 25,
        total: 0,
        items: [],
        kinds: [],
      },
    },
  });
  f.panel.connect();
  f.elements._godseyeTargetInput.value = 'Madrid';
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.equal(
    f.elements._godseyeTargetInvolvement.children[0].textContent,
    'NO RESULTS',
  );
  assert.equal(
    f.elements._godseyeTargetNearby.children[0].textContent,
    'NO RESULTS',
  );
  assert.equal(f.elements._godseyeTargetPosition.children.length, 3);
});

test('a block whose source is unavailable is shown as unavailable', async () => {
  const f = fixture({
    profile: {
      ...PROFILE,
      position: {
        status: 'unavailable',
        name: 'Madrid',
        radiusKm: 25,
        detail: 'the target could not be geocoded',
      },
      nearby: {
        status: 'unavailable',
        radiusKm: 25,
        total: 0,
        items: [],
        kinds: [],
        detail: 'the target could not be geocoded',
      },
      sources: [
        {
          name: 'nominatim',
          ok: false,
          detail: 'the target could not be geocoded',
        },
        { name: 'search', ok: true, detail: 'answered' },
        {
          name: 'overpass',
          ok: false,
          detail: 'the target could not be geocoded',
        },
      ],
    },
  });
  f.panel.connect();
  f.elements._godseyeTargetInput.value = 'Madrid';
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.equal(
    f.elements._godseyeTargetPosition.children[0].textContent,
    'the target could not be geocoded',
  );
  assert.equal(
    f.elements._godseyeTargetNearby.children[0].textContent,
    'the target could not be geocoded',
  );
  assert.equal(f.elements._godseyeTargetStatus.textContent, 'UNAVAILABLE');
});

test('the panel stops working after it is destroyed', async () => {
  const f = fixture();
  f.panel.connect();
  f.panel.destroy();
  f.elements._godseyeTargetInput.value = 'Madrid';
  f.elements._godseyeTargetBtn.dispatchEvent(new Event('click'));
  await settle();

  assert.equal(f.requests.length, 0);
});
