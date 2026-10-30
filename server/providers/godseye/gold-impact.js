/**
 * The Gold Impact feed: what is moving gold right now, and why it matters.
 *
 * Market quotes, live headlines and world events are merged into one ranked
 * list of drivers. The result is a RELEVANCE SCORE, never a claim of cause:
 * the UI has to label it that way.
 */

import { fetchMarket } from './market.js';
import { fetchNews } from './news.js';
import { fetchOsint } from './osint.js';
import { scoreDrivers } from './drivers.js';

const DEFAULT_TOP = 10;

/**
 * Build the feed.
 *
 * @param {object} [options]
 * @param {object} [options.market] a prepared market result (tests inject one)
 * @param {object} [options.news] a prepared news result
 * @param {object} [options.osint] a prepared osint result
 * @param {number} [options.top] how many drivers to keep
 * @param {number} [options.now]
 */
export async function buildGoldImpact(options = {}) {
  const [marketData, newsData, osintData] = await Promise.all([
    options.market || fetchMarket(options),
    options.news || fetchNews(options),
    options.osint || fetchOsint(options),
  ]);
  const marketById = Object.fromEntries(
    (marketData.series || []).map((entry) => [entry.id, entry]),
  );
  const now = options.now ?? Date.now();
  const drivers = scoreDrivers({
    market: marketById,
    news: newsData.items || [],
    now,
  });
  const gold = marketById.gold || null;
  const composite = drivers.reduce((sum, driver) => sum + driver.impact, 0);
  return {
    generatedAt: now,
    gold: gold
      ? {
          symbol: gold.symbol,
          label: gold.label,
          price: gold.price,
          changePct: gold.changePct,
          source: gold.source,
        }
      : null,
    composite: {
      impact: Number(composite.toFixed(3)),
      direction: composite > 0.05 ? 'up' : composite < -0.05 ? 'down' : 'flat',
      note: 'relevance score, not a cause',
    },
    drivers: drivers.slice(0, options.top ?? DEFAULT_TOP),
    news: (newsData.items || []).slice(0, options.newsLimit ?? 12),
    osint: (osintData.items || []).slice(0, options.osintLimit ?? 10),
    sources: {
      market: (marketData.series || []).map((entry) => ({
        id: entry.id,
        symbol: entry.symbol,
        price: entry.price,
        changePct: entry.changePct,
      })),
      marketFailed: marketData.failed || [],
      newsFailed: newsData.failed || [],
      osintFailed: osintData.failed || [],
    },
  };
}

/**
 * Render the feed as plain text for a terminal or a log line.
 *
 * @param {object} feed
 * @returns {string}
 */
export function formatGoldReport(feed) {
  const lines = [];
  lines.push('=== GOLD IMPACT (relevance score, not a cause) ===');
  const gold = feed.gold;
  lines.push(
    gold
      ? `XAUUSD proxy ${gold.symbol}: ${gold.price?.toFixed?.(2) ?? '—'} (${
          gold.changePct === null || gold.changePct === undefined
            ? '—'
            : `${gold.changePct >= 0 ? '+' : ''}${gold.changePct.toFixed(2)}%`
        })`
      : 'XAUUSD: no quote available',
  );
  lines.push(
    `Composite: ${feed.composite.impact} (${feed.composite.direction})`,
  );
  lines.push('');
  lines.push('DRIVER');
  for (const driver of feed.drivers) {
    const arrow =
      driver.direction === 'up' ? '▲' : driver.direction === 'down' ? '▼' : '▬';
    lines.push(
      `  ${arrow} ${driver.label.padEnd(34)} ${driver.impact.toFixed(3).padStart(7)}  ${driver.detail}`,
    );
  }
  lines.push('');
  lines.push('HEADLINES');
  for (const item of feed.news.slice(0, 8)) {
    const when = item.publishedAt
      ? new Date(item.publishedAt).toISOString().slice(0, 16)
      : '—';
    lines.push(`  [${when}] ${item.title.slice(0, 110)} (${item.source})`);
  }
  if (feed.osint.length) {
    lines.push('');
    lines.push('WORLD EVENTS (24 h)');
    for (const item of feed.osint.slice(0, 6)) {
      lines.push(`  ${item.title} — ${item.place || '-'} (${item.source})`);
    }
  }
  const failed = [
    ...(feed.sources.marketFailed || []),
    ...(feed.sources.newsFailed || []),
    ...(feed.sources.osintFailed || []),
  ];
  if (failed.length) {
    lines.push('');
    lines.push('FAILED SOURCES:');
    for (const item of failed) {
      lines.push(`  ${item.id || item.query || item.source}: ${item.error}`);
    }
  }
  return lines.join('\n');
}
