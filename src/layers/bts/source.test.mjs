import assert from 'node:assert/strict';
import test from 'node:test';

import { createBtsSource, fetchBtsRegistry } from './source.js';

test('the source asks the same route the panel reads', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        ok: true,
        sites: [{ id: 'a', lat: -4.1, lon: 138.95 }],
        source: 'bts-registry',
      }),
    };
  };
  const payload = await fetchBtsRegistry({ fetchImpl });
  assert.equal(payload.sites.length, 1);
  assert.match(calls[0], /\/api\/godseye\/bts\?catalog=1&sites=1/);
});

test('a failed registry read throws, so the layer shows the reason', async () => {
  await assert.rejects(
    () =>
      fetchBtsRegistry({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /503/,
  );
  await assert.rejects(
    () =>
      fetchBtsRegistry({
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ error: 'boom' }),
        }),
      }),
    /boom/,
  );
});

test('the snapshot carries the synthetic flag, so a seed registry is not read as real', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      sites: [],
      source: 'local-seed',
      synthetic: true,
    }),
  });
  const snapshot = await createBtsSource({ fetchImpl }).getSnapshot();
  assert.equal(snapshot.synthetic, true);
  assert.equal(snapshot.source, 'local-seed');
  assert.deepEqual(snapshot.sites, []);
});
