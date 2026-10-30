#!/usr/bin/env node
/**
 * Dashboard Builder — gabungkan semua data lokal Indonesia/Papua ke satu JSON.
 *
 *   node server/services/place-card-local/dashboard-cli.mjs
 *   node server/services/place-card-local/dashboard-cli.mjs --output src/data/place-card-results/dashboard-indonesia.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

async function main() {
  const output = arg('output', 'src/data/place-card-results/dashboard-indonesia.json');
  const basePath = resolve('src/data/place-card-results');

  // Load all place cards
  const placeCards = {};
  const cities = ['jakarta', 'papua', 'surabaya', 'bali', 'bandung', 'yogyakarta', 'medan', 'semarang', 'denpasar', 'makassar', 'jayapura', 'sorong', 'manokwari', 'merauke', 'wamena', 'nabire', 'biak', 'timika', 'tolikara', 'yahukimo', 'puncak', 'puncak-jaya'];
  for (const city of cities) {
    try {
      const filePath = resolve(basePath, `${city}.json`);
      placeCards[city] = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      // skip if not exists
    }
  }

  // Load news
  let news = null;
  try {
    news = JSON.parse(readFileSync(resolve(basePath, 'indonesia-news.json'), 'utf-8'));
  } catch {}

  // Load targets
  let targets = null;
  try {
    targets = JSON.parse(readFileSync(resolve(basePath, 'papua-targets.json'), 'utf-8'));
  } catch {}

  // Load vision
  let vision = null;
  try {
    vision = JSON.parse(readFileSync(resolve(basePath, 'vision-papua.json'), 'utf-8'));
  } catch {}

  const dashboard = {
    // i18n-ignore: artifact title, not UI copy
    title: 'God\'s Eye — Dashboard Indonesia & Papua',
    generatedAt: Date.now(),
    generatedAtISO: new Date().toISOString(),
    source: 'local-only',
    summary: {
      cities: Object.keys(placeCards).length,
      newsItems: news?.count || 0,
      papuaNewsItems: news?.items?.filter(i => /papua/i.test(i.title)).length || 0,
      targets: targets?.count || 0,
      visionAreas: vision?.length || 0,
      cctvCameras: 21,
    },
    regions: {
      indonesia: Object.keys(placeCards).filter(k => !['jayapura','sorong','manokwari','merauke','wamena','nabire','biak','timika','tolikara','yahukimo','puncak','puncak-jaya'].includes(k)),
      papua: ['jayapura','sorong','manokwari','merauke','wamena','nabire','biak','timika','tolikara','yahukimo','puncak','puncak-jaya'],
    },
    placeCards,
    news: news ? { count: news.count, items: news.items.slice(0, 50) } : null,
    targets,
    vision,
    cctv: {
      total: 21,
      papua: 12,
      other: 9,
    },
  };

  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(dashboard, null, 2));
  console.log(`Dashboard saved to: ${outputPath}`);
  console.log(`  Cities: ${dashboard.summary.cities}`);
  console.log(`  News: ${dashboard.summary.newsItems} (${dashboard.summary.papuaNewsItems} Papua)`);
  console.log(`  Targets: ${dashboard.summary.targets}`);
  console.log(`  Vision areas: ${dashboard.summary.visionAreas}`);
  console.log(`  CCTV: ${dashboard.summary.cctvCameras}`);
}

main().catch((e) => {
  console.error(`GAGAL: ${e?.message || e}`);
  process.exit(1);
});