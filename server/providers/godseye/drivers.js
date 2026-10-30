/**
 * Gold drivers: what links market moves and headlines to a gold score.
 *
 * The score is a RELEVANCE score, not a cause: a z-score of the daily change
 * (an unusual move today), weighted per driver and signed by how that series
 * leans on gold, plus headline matches that fade with age.
 */

/**
 * Driver table. `series` names a market series; `keywords` match headlines.
 * A series-only driver carries no keywords: every gold headline would shift a
 * score already measured from the price.
 */
export const DRIVERS = [
  {
    id: 'gold_self',
    label: 'Gold price move',
    weight: 1.0,
    series: 'gold',
    keywords: [],
  },
  {
    id: 'fed_policy',
    label: 'Federal Reserve policy',
    weight: 0.9,
    series: null,
    keywords: [
      'federal reserve',
      'fomc',
      'powell',
      'rate cut',
      'rate hike',
      'interest rate decision',
      'fed chair',
    ],
  },
  {
    id: 'inflation',
    label: 'Inflation (CPI/PCE)',
    weight: 0.85,
    series: null,
    keywords: ['inflation', 'cpi', 'consumer price', 'pce', 'price index'],
  },
  {
    id: 'jobs',
    label: 'Labour data',
    weight: 0.8,
    series: null,
    keywords: [
      'payroll',
      'nonfarm',
      'jobs report',
      'unemployment',
      'jobless claims',
    ],
  },
  {
    id: 'real_yields',
    label: 'US 10-year yield',
    weight: 0.85,
    series: 'yields',
    keywords: ['treasury yield', '10-year yield', 'bond yield'],
  },
  {
    id: 'dxy',
    label: 'Dollar index (DXY)',
    weight: 0.8,
    series: 'dxy',
    keywords: ['dollar index', 'greenback', 'us dollar'],
  },
  {
    id: 'geopolitics',
    label: 'Geopolitical escalation',
    weight: 0.7,
    series: null,
    keywords: [
      'invasion',
      'airstrike',
      'missile',
      'ceasefire',
      'coup',
      'war',
      'conflict',
      'militant',
    ],
  },
  {
    id: 'cb_gold',
    label: 'Central bank gold buying',
    weight: 0.65,
    series: null,
    keywords: [
      'central bank gold',
      'central bank buying',
      'pboc',
      'gold reserves',
      'reserve accumulation',
    ],
  },
  {
    id: 'oil_supply',
    label: 'Oil supply shock (ambiguous)',
    weight: 0.35,
    series: 'oil',
    keywords: ['opec', 'oil supply', 'tanker', 'pipeline', 'refinery', 'crude'],
  },
  {
    id: 'etf_flows',
    label: 'Gold ETF flows (GLD)',
    weight: 0.5,
    series: 'etf',
    keywords: ['gld', 'gold etf', 'etf inflows', 'etf outflows'],
  },
  {
    id: 'risk_off',
    label: 'Equity risk-off',
    weight: 0.4,
    series: 'risk',
    keywords: [
      'selloff',
      'sell-off',
      'risk-off',
      'flight to safety',
      'safe haven',
    ],
  },
  {
    id: 'funding',
    label: 'USD funding stress',
    weight: 0.6,
    series: null,
    keywords: [
      'dollar funding',
      'repo rate',
      'sofr',
      'money market stress',
      'bank stress',
    ],
  },
];

/** Headline weight halves roughly every six hours. */
export const DECAY_HOURS = 6;

/**
 * Mean and population standard deviation.
 *
 * @param {number[]} values
 */
export function meanStd(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return { mean: 0, std: 0, n: 0 };
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance =
    clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  return { mean, std: Math.sqrt(variance), n: clean.length };
}

/**
 * z-score of the last value against the last `window` values.
 *
 * @param {number[]} values
 * @param {number} [window]
 */
export function zscoreLast(values, window = 30) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 3) return 0;
  const slice = clean.slice(-window);
  const { mean, std } = meanStd(slice);
  if (!std) return 0;
  return (slice[slice.length - 1] - mean) / std;
}

/**
 * Percentage change between the last two values.
 *
 * @param {number[]} values
 */
export function pctChange(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return null;
  const last = clean[clean.length - 1];
  const previous = clean[clean.length - 2];
  if (!previous) return null;
  return ((last - previous) / previous) * 100;
}

/**
 * Daily percentage changes of a price series.
 *
 * @param {number[]} values
 * @returns {number[]}
 */
export function dailyChanges(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  const changes = [];
  for (let index = 1; index < clean.length; index += 1) {
    const previous = clean[index - 1];
    if (!previous) continue;
    changes.push(((clean[index] - previous) / previous) * 100);
  }
  return changes;
}

/**
 * Time fade for a headline of the given age.
 *
 * @param {number} ageMs
 * @returns {number}
 */
export function decay(ageMs) {
  if (!Number.isFinite(ageMs)) return 0;
  const hours = Math.max(0, ageMs / 3600000);
  return Math.exp(-hours / DECAY_HOURS);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  return value >= 100 ? value.toFixed(2) : value.toFixed(4);
}

/**
 * Score one driver from a market series.
 *
 * @param {object} driver
 * @param {Record<string, object>} market
 */
export function scoreSeries(driver, market) {
  const entry = market?.[driver.series];
  if (!entry || !driver.series) return null;
  const changes = dailyChanges(entry.series || []);
  const z = zscoreLast(changes, 30);
  const today = changes.length ? changes[changes.length - 1] : null;
  const sign = entry.sign ?? 1;
  return {
    id: driver.id,
    label: driver.label,
    kind: 'series',
    impact: driver.weight * z * sign,
    z,
    changePct: today,
    detail: `${entry.label}: ${entry.symbol} ${formatNumber(entry.price)} (${
      today === null ? '—' : `${today >= 0 ? '+' : ''}${today.toFixed(2)}%`
    }, z=${z.toFixed(2)})`,
  };
}

/**
 * Score one driver from headline matches.
 *
 * @param {object} driver
 * @param {Array<{title:string,publishedAt:number|null}>} items
 * @param {number} now
 */
export function scoreNews(driver, items, now = Date.now()) {
  const keywords = driver.keywords || [];
  const matched = [];
  for (const item of items) {
    const title = String(item.title || '').toLowerCase();
    const hits = keywords.filter((keyword) =>
      title.includes(String(keyword).toLowerCase()),
    );
    if (!hits.length) continue;
    const age = item.publishedAt ? decay(now - item.publishedAt) : 0.25;
    matched.push({
      item,
      hits,
      age,
      weight: driver.weight * age * Math.min(1.5, hits.length),
    });
  }
  if (!matched.length) return null;
  const impact = matched.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    id: driver.id,
    label: driver.label,
    kind: 'news',
    impact,
    matches: matched.sort((a, b) => b.weight - a.weight),
    detail: `${matched.length} related headlines`,
  };
}

/**
 * Score every driver and sort by absolute impact.
 *
 * @param {object} input
 * @param {Record<string, object>} [input.market]
 * @param {Array} [input.news]
 * @param {Array} [input.drivers]
 * @param {number} [input.now]
 */
export function scoreDrivers({
  market = {},
  news = [],
  drivers = DRIVERS,
  now = Date.now(),
} = {}) {
  const results = [];
  for (const driver of drivers) {
    const fromSeries = scoreSeries(driver, market);
    const fromNews = scoreNews(driver, news, now);
    if (!fromSeries && !fromNews) continue;
    const impact = (fromSeries?.impact || 0) + (fromNews?.impact || 0);
    results.push({
      id: driver.id,
      label: driver.label,
      impact,
      direction: impact > 0.05 ? 'up' : impact < -0.05 ? 'down' : 'flat',
      series: fromSeries,
      news: fromNews,
      detail: [fromSeries?.detail, fromNews?.detail]
        .filter(Boolean)
        .join(' · '),
    });
  }
  results.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return results;
}
