/**
 * Operator network location — the number→position path that needs no cell id.
 *
 * GSMA Open Gateway / CAMARA `Device Location Retrieval`-style endpoints take
 * an MSISDN and return the last known network position as a circle
 * (latitude, longitude, radius). Vonage exposes it as
 * `POST /network-location/v0.1/retrieval`; Telkomsel, Indosat Ooredoo
 * Hutchison and XLSmart have joined the Open Gateway alliance in Indonesia.
 *
 * This adapter is a thin client: it does not invent a provider. With no
 * credentials configured it answers `available:false` and the exact steps to
 * register — the honest state of a capability that needs an operator-approved
 * account. The env is read at call time, never captured at module load.
 */

/** Vendor adapters: name → { baseUrl, buildBody, mapResult }. */
const VENDORS = Object.freeze({
  vonage: {
    name: 'Vonage Device Location Retrieval',
    baseUrl: 'https://api-eu.vonage.com/network-location/v0.1/retrieval',
    buildBody: (e164) => ({ phoneNumber: e164, maxAge: '168h' }),
    mapResult: (json) => {
      const loc = json?.location;
      if (
        !loc ||
        !Number.isFinite(Number(loc.lat)) ||
        !Number.isFinite(Number(loc.lon))
      ) {
        return null;
      }
      return {
        lat: Number(loc.lat),
        lon: Number(loc.lon),
        accuracyM: Number.isFinite(Number(loc.radius))
          ? Math.max(0, Math.round(Number(loc.radius)))
          : null,
        lastLocationTime: loc.last_location_time || null,
      };
    },
  },
  camara: {
    name: 'CAMARA Device Location',
    baseUrl: 'https://example.invalid/device-location/v0/retrieval',
    buildBody: (e164) => ({
      device: { phoneNumber: e164 },
      maxAge: 168,
    }),
    mapResult: (json) => {
      const loc = json?.location;
      if (
        !loc ||
        !Number.isFinite(Number(loc.latitude)) ||
        !Number.isFinite(Number(loc.longitude))
      ) {
        return null;
      }
      return {
        lat: Number(loc.latitude),
        lon: Number(loc.longitude),
        accuracyM: Number.isFinite(Number(loc.radius))
          ? Math.max(0, Math.round(Number(loc.radius)))
          : null,
        lastLocationTime: json?.lastLocationTime || null,
      };
    },
  },
});

/** Which provider is configured, if any. Reads env at call time. */
export function operatorLocationProvider(env = process.env) {
  const provider = String(env.GODSEYE_LOCATION_PROVIDER || 'off')
    .trim()
    .toLowerCase();
  const vendor = VENDORS[provider];
  if (!vendor) {
    return {
      available: false,
      provider,
      reason: 'unknown-provider',
      hint: 'GODSEYE_LOCATION_PROVIDER must be vonage or camara',
    };
  }
  const token =
    env[`${provider.toUpperCase()}_API_TOKEN`] || env.VONAGE_API_TOKEN;
  const key = env[`${provider.toUpperCase()}_API_KEY`];
  const secret = env[`${provider.toUpperCase()}_API_SECRET`];
  if (!token && !(key && secret)) {
    return {
      available: false,
      provider,
      reason: 'not-configured',
      hint:
        `${provider.toUpperCase()}_API_TOKEN (or _API_KEY + _API_SECRET) is ` +
        `missing. Register through the GSMA Open Gateway / network API ` +
        `program: business profile, operator approval for Device Location, ` +
        `a stated legal basis and a privacy policy are the requirements.`,
    };
  }
  return { available: true, provider, name: vendor.name };
}

/**
 * Query the operator network for the last known position of a number.
 *
 * @param {object} options
 * @param {string} options.e164 - the number in E.164 form
 * @param {object} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function queryOperatorLocation(options) {
  const {
    e164,
    env = process.env,
    fetchImpl = (...args) => fetch(...args),
  } = options;
  const provider = operatorLocationProvider(env);
  if (!provider.available) {
    return { ok: false, ...provider };
  }
  const vendor = VENDORS[provider.provider];
  const token = env[`${provider.provider.toUpperCase()}_API_TOKEN`];
  const key = env[`${provider.provider.toUpperCase()}_API_KEY`];
  const secret = env[`${provider.provider.toUpperCase()}_API_SECRET`];
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (!token && key && secret) {
    const basic = Buffer.from(`${key}:${secret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }
  let response;
  try {
    response = await fetchImpl(vendor.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(vendor.buildBody(e164)),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'upstream_unreachable',
      detail: error?.message,
    };
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: 'provider_error',
      status: response.status,
      detail: json?.message || json?.error || `HTTP ${response.status}`,
    };
  }
  const mapped = vendor.mapResult(json);
  if (!mapped) {
    return {
      ok: false,
      reason: 'unparseable',
      detail: 'no location in provider response',
    };
  }
  return { ok: true, provider: provider.provider, ...mapped };
}
