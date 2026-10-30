/**
 * BTS source — the tower registry, read the same way the panel reads it.
 *
 * One payload, one truth: the globe and the panel ask the same route, so they
 * can never disagree about how many towers exist. The registry is a local
 * artifact (a sweep writes it), so this is a local read with no provider key.
 */

const ENDPOINT = '/api/godseye/bts?catalog=1&sites=1';

/** Fetch the registry payload the layer draws from. */
export async function fetchBtsRegistry({ signal, fetchImpl = null } = {}) {
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== 'function') throw new Error('no fetch available');
  const response = await impl(ENDPOINT, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response?.ok) {
    throw new Error(
      `BTS registry answered ${response?.status ?? 'no response'}`,
    );
  }
  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(payload?.error || 'the registry payload was not usable');
  }
  return payload;
}

/** A snapshot source the layer can poll, with the registry flattened. */
export function createBtsSource({ fetchImpl = null } = {}) {
  return {
    id: 'bts',
    async getSnapshot({ signal } = {}) {
      const payload = await fetchBtsRegistry({ signal, fetchImpl });
      return {
        sites: Array.isArray(payload.sites) ? payload.sites : [],
        source: payload.source || 'local',
        synthetic: Boolean(payload.synthetic),
      };
    },
  };
}
