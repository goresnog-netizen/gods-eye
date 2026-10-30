/**
 * Market quotes for the Gold Impact feed.
 *
 * Yahoo Finance's chart endpoint is public and needs no key, so the feed keeps
 * working without an account. Spot gold ("XAUUSD=X") is not served there, so
 * the feed quotes COMEX futures (GC=F) and labels them as a proxy.
 */

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (GodsEye/1.0; +local research console)',
  Accept: 'application/json',
};

/**
 * The series the feed scores. `sign` is how a rise in the series leans on gold:
 * a rising dollar or yield presses gold down, a rising ETF flow lifts it.
 */
export const MARKET_SERIES = [
  { id: 'gold', symbol: 'GC=F', label: 'Gold (GC=F, COMEX)', sign: 1 },
  { id: 'dxy', symbol: 'DX-Y.NYB', label: 'Dollar index (DXY)', sign: -1 },
  { id: 'yields', symbol: '^TNX', label: 'US 10-year yield (^TNX)', sign: -1 },
  { id: 'oil', symbol: 'CL=F', label: 'WTI crude (CL=F)', sign: 1 },
  { id: 'risk', symbol: '^GSPC', label: 'S&P 500 (^GSPC)', sign: -1 },
  { id: 'etf', symbol: 'GLD', label: 'GLD gold ETF', sign: 1 },
];

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Fetch one quote series.
 *
 * @param {{id:string,symbol:string,label:string,sign:number}} spec
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.range]
 * @param {string} [options.interval]
 */
export async function fetchYahooSeries(spec, options = {}) {
  const {
    fetchImpl = (...args) => fetch(...args),
    range = '3mo',
    interval = '1d',
    headers = DEFAULT_HEADERS,
  } = options;
  const url = `${YAHOO_CHART}${encodeURIComponent(spec.symbol)}?range=${range}&interval=${interval}`;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const error = new Error(`yahoo ${spec.symbol} HTTP ${response.status}`);
    error.code = 'upstream_error';
    throw error;
  }
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const stamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close
    : [];
  const series = closes.filter((value) => Number.isFinite(value));
  if (series.length > 4096) series.length = 4096;
  const price = Number(meta.regularMarketPrice ?? series[series.length - 1]);
  const previous = series.length > 1 ? series[series.length - 2] : null;
  const changePct =
    Number.isFinite(price) && Number.isFinite(previous) && previous !== 0
      ? ((price - previous) / previous) * 100
      : null;
  return {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    sign: spec.sign,
    price: Number.isFinite(price) ? price : null,
    changePct,
    series,
    timestamps: stamps.slice(-4096),
    currency: meta.currency || null,
    source: url,
    bytes: MAX_RESPONSE_BYTES,
  };
}

/**
 * Fetch every series. A failing symbol is reported, never fatal.
 *
 * @param {object} [options]
 * @param {Array} [options.specs]
 */
export async function fetchMarket(options = {}) {
  const specs = options.specs || MARKET_SERIES;
  const results = await Promise.allSettled(
    specs.map((spec) => fetchYahooSeries(spec, options)),
  );
  const series = [];
  const failed = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') series.push(result.value);
    else
      failed.push({
        id: specs[index].id,
        symbol: specs[index].symbol,
        error: result.reason?.message || 'failed',
      });
  });
  return { series, failed, fetchedAt: Date.now() };
}
