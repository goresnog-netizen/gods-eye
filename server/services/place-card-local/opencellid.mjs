/**
 * OpenCellID client — the one provider this console is allowed to call.
 *
 * The API is documented at https://wiki.opencellid.org/docs/api/overview and
 * has two shapes that matter here:
 *
 *   GET /cell/get          one cell, by mcc/mnc/lac/cellid  → JSON object
 *   GET /cell/getInArea    cells in a BBOX, 50 per page     → {count, cells[]}
 *   GET /cell/getInAreaSize  how many cells a BBOX holds     → {count}
 *
 * Two facts about that JSON are easy to get wrong and were:
 *
 *   1. There is NO `status` field. A success is an object with `lat`/`lon`;
 *      an error is `{error, code}`. Code that waits for `status === 'ok'`
 *      discards every successful answer and silently falls back to an
 *      estimate — which is what this module replaces.
 *   2. `limit` is capped at 50. An area larger than 50 cells must be paged
 *      with `offset`, and each page costs one of the 1,000 daily credits.
 *
 * Everything is dependency-injected (`fetchImpl`) so the tests exercise the
 * parsing, paging and error paths without a key and without the network.
 */

export const OCID_BASE = 'https://opencellid.org';
export const OCID_MAX_LIMIT = 50;
export const OCID_DAILY_CREDITS = 1000;
export const OCID_ATTRIBUTION = 'OpenCelliD (CC BY-SA 4.0)';

/** The radios OpenCellID accepts, in the spelling the API expects. */
const RADIOS = new Set(['GSM', 'UMTS', 'LTE', 'NR', 'NBIOT', 'CDMA']);

/** OpenCellID radio → the technology label the panel shows. */
export function techFromRadio(radio) {
  const value = String(radio || '').toUpperCase();
  if (value === 'LTE') return '4G';
  if (value === 'NR') return '5G';
  if (value === 'UMTS' || value === 'WCDMA' || value === 'HSPA') return '3G';
  if (value === 'GSM' || value === 'CDMA') return '2G';
  if (value === 'NBIOT') return 'NB-IoT';
  return 'unknown';
}

/** A radio string the API will accept, or null so the parameter is omitted. */
export function normalizeRadio(radio) {
  const value = String(radio || '').toUpperCase();
  return RADIOS.has(value) ? value : null;
}

/** The planning radius for a technology, used when the API reports none. */
export function rangeKmFor(tech, rangeM) {
  if (Number.isFinite(rangeM) && rangeM > 0) return Math.round(rangeM) / 1000;
  if (tech === '5G') return 1;
  if (tech === '4G') return 5;
  if (tech === '3G') return 10;
  return 35;
}

/** Whether an optional filter was actually supplied (0 is a value, null is not). */
function given(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One raw OpenCellID record → the shape the registry and the routes use.
 *
 * `samples` is kept because it is the only quality signal the dataset has:
 * a cell seen twice is a rumour, a cell seen four hundred times is a tower
 * people actually connect to.
 */
export function cellFromOcid(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = finite(raw.lat);
  const lon = finite(raw.lon);
  if (lat === null || lon === null) return null;
  if (lat === 0 && lon === 0) return null;
  const radio = normalizeRadio(raw.radio);
  const tech = techFromRadio(raw.radio);
  const mcc = finite(raw.mcc);
  const mnc = finite(raw.mnc);
  if (mcc === null || mnc === null) return null;
  const rangeM = finite(raw.range);
  return {
    lat,
    lon,
    mcc,
    mnc,
    lac: finite(raw.lac) ?? 0,
    cellId: finite(raw.cellid) ?? finite(raw.cellId) ?? 0,
    rangeM,
    rangeKm: rangeKmFor(tech, rangeM),
    samples: finite(raw.samples) ?? 1,
    radio: radio || String(raw.radio || '').toUpperCase() || 'unknown',
    tech,
  };
}

function bboxParam(bbox) {
  return [bbox.south, bbox.west, bbox.north, bbox.east]
    .map((value) => Number(value))
    .join(',');
}

async function readJson(response) {
  const text = await response.text();
  if (!text)
    return { ok: false, status: response.status, error: 'empty_response' };
  try {
    return { ok: true, status: response.status, data: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      status: response.status,
      error: 'not_json',
      detail: text.slice(0, 200),
    };
  }
}

/**
 * The failure an OpenCellID answer carries, if any.
 *
 * Errors arrive with HTTP 200 as often as not, so the body is the authority.
 */
function apiError(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.error) {
    return { error: String(payload.error), code: finite(payload.code) };
  }
  if (payload.status && String(payload.status).toLowerCase() === 'error') {
    return {
      error: String(payload.message || 'api_error'),
      code: finite(payload.code),
    };
  }
  return null;
}

async function requestJson(url, { fetchImpl, timeoutMs }) {
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== 'function') {
    return { ok: false, error: 'fetch_unavailable' };
  }
  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
    : null;
  try {
    const response = await impl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    const parsed = await readJson(response);
    if (!parsed.ok) {
      return {
        ok: false,
        status: parsed.status ?? response.status,
        error: parsed.error,
        detail: parsed.detail,
      };
    }
    const failure = apiError(parsed.data);
    if (failure) {
      return { ok: false, status: response.status, ...failure };
    }
    return { ok: true, status: response.status, data: parsed.data };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'timeout' : 'network_error',
      detail: error?.message || null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Position of one cell.
 *
 * `radio` narrows the match when one lac/cellid pair is reused across
 * technologies, which happens in older GSM/UMTS deployments.
 */
export async function cellPosition({
  key,
  mcc,
  mnc,
  lac,
  cellId,
  radio = null,
  fetchImpl = null,
  timeoutMs = 15_000,
} = {}) {
  if (!key) return { ok: false, error: 'key_required' };
  if (
    ![mcc, mnc, lac, cellId].every((value) => Number.isFinite(Number(value)))
  ) {
    return { ok: false, error: 'cell_fields_required' };
  }
  const params = new URLSearchParams({
    key,
    mcc: String(mcc),
    mnc: String(mnc),
    lac: String(lac),
    cellid: String(cellId),
    format: 'json',
  });
  const normalized = normalizeRadio(radio);
  if (normalized) params.set('radio', normalized);

  const answer = await requestJson(`${OCID_BASE}/cell/get?${params}`, {
    fetchImpl,
    timeoutMs,
  });
  if (!answer.ok) return answer;

  const cell = cellFromOcid(answer.data);
  if (!cell)
    return { ok: false, error: 'cell_not_found', status: answer.status };
  return { ok: true, cell, credits: 1, source: 'opencellid' };
}

/**
 * Cells inside a box, one page at a time.
 *
 * A page of 50 is the API maximum, so `hasMore` is derived from the reported
 * total rather than from the page being short: a full page in a dense area is
 * not the end of the list.
 */
export async function cellsInArea({
  key,
  bbox,
  mcc = null,
  mnc = null,
  lac = null,
  radio = null,
  limit = OCID_MAX_LIMIT,
  offset = 0,
  fetchImpl = null,
  timeoutMs = 30_000,
} = {}) {
  if (!key) return { ok: false, error: 'key_required' };
  if (!bbox) return { ok: false, error: 'bbox_required' };
  const pageSize = Math.min(
    OCID_MAX_LIMIT,
    Math.max(1, Number(limit) || OCID_MAX_LIMIT),
  );
  const params = new URLSearchParams({
    key,
    BBOX: bboxParam(bbox),
    format: 'json',
    limit: String(pageSize),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  // `Number(null) === 0`: without the `given` guard every call would filter on
  // mcc=0 and answer "no cells" for the whole planet.
  if (given(mcc)) params.set('mcc', String(Number(mcc)));
  if (given(mnc)) params.set('mnc', String(Number(mnc)));
  if (given(lac)) params.set('lac', String(Number(lac)));
  const normalized = normalizeRadio(radio);
  if (normalized) params.set('radio', normalized);

  const answer = await requestJson(`${OCID_BASE}/cell/getInArea?${params}`, {
    fetchImpl,
    timeoutMs,
  });
  if (!answer.ok) return answer;

  const raw = Array.isArray(answer.data?.cells) ? answer.data.cells : [];
  const cells = raw.map(cellFromOcid).filter(Boolean);
  const total = Number.isFinite(Number(answer.data?.count))
    ? Number(answer.data.count)
    : cells.length;
  const nextOffset = Number(offset) + raw.length;
  return {
    ok: true,
    total,
    cells,
    // `raw.length` rather than `cells.length`: a record that failed to parse
    // still occupied a slot, and re-requesting it would loop forever.
    hasMore: raw.length > 0 && nextOffset < total,
    nextOffset,
    credits: 1,
  };
}

/** How many cells a box holds — one credit, and the cheapest way to plan. */
export async function areaSize({
  key,
  bbox,
  mcc = null,
  mnc = null,
  radio = null,
  fetchImpl = null,
  timeoutMs = 20_000,
} = {}) {
  if (!key) return { ok: false, error: 'key_required' };
  if (!bbox) return { ok: false, error: 'bbox_required' };
  const params = new URLSearchParams({
    key,
    BBOX: bboxParam(bbox),
    format: 'json',
  });
  if (given(mcc)) params.set('mcc', String(Number(mcc)));
  if (given(mnc)) params.set('mnc', String(Number(mnc)));
  const normalized = normalizeRadio(radio);
  if (normalized) params.set('radio', normalized);

  const answer = await requestJson(
    `${OCID_BASE}/cell/getInAreaSize?${params}`,
    {
      fetchImpl,
      timeoutMs,
    },
  );
  if (!answer.ok) return answer;
  const count = Number(answer.data?.count);
  if (!Number.isFinite(count)) return { ok: false, error: 'count_missing' };
  return { ok: true, count, credits: 1 };
}

/** The key the server holds, or an empty string. Never logged, never sent out. */
export function apiKeyFromEnv(env = process.env) {
  return String(env?.OPENCELLID_API_KEY || '').trim();
}

/** Whether a failed answer means the day's quota is gone (code 7). */
export function isQuotaError(answer) {
  if (!answer || answer.ok) return false;
  if (Number(answer.code) === 7) return true;
  return /daily limit|quota|too many requests/i.test(
    String(answer.error || ''),
  );
}

/** Whether the request itself was malformed — a bug, not a per-area condition. */
export function isInputError(answer) {
  if (!answer || answer.ok) return false;
  return Number(answer.code) === 3;
}

/**
 * Whether a failed answer means the key is the problem.
 *
 * This matters for the sweep: an auth failure is not a per-tile problem, and
 * retrying 132 tiles with a bad key burns the day's quota to learn nothing.
 * OpenCellID answers code 2 for an unknown key.
 */
export function isAuthError(answer) {
  if (!answer || answer.ok) return false;
  if (Number(answer.code) === 2) return true;
  // Deliberately narrow: "Daily limit exceeded for your API key" mentions a
  // key but is a quota error (code 7), not a bad token.
  return /api key not known|invalid (api )?key|key not known|unauthori[sz]ed|forbidden/i.test(
    String(answer.error || ''),
  );
}
