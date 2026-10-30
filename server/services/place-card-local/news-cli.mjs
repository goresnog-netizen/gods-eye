#!/usr/bin/env node
/**
 * Indonesia News CLI — lokal, tanpa external provider calls.
 *
 *   node server/services/place-card-local/news-cli.mjs
 *   node server/services/place-card-local/news-cli.mjs --query "Papua" --json
 *   node server/services/place-card-local/news-cli.mjs --output src/data/news/indonesia-news.json
 */

import { fetchIndonesiaNews } from './indonesia-news.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

async function main() {
  const query = arg('query', null);
  const queries = query ? [query] : undefined;
  const json = Boolean(arg('json', false));
  const output = arg('output', null);
  const perQuery = Number(arg('per', 10)) || 10;

  const result = await fetchIndonesiaNews({ queries, perQuery });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Indonesia News Feed — ${result.count} items from ${result.queries} queries`);
    console.log(`Generated: ${new Date(result.generatedAt).toISOString()}`);
    console.log('');
    for (const item of result.items.slice(0, 20)) {
      console.log(`[${item.source}] ${item.title}`);
      console.log(`  ${item.link}`);
      if (item.publishedAt) console.log(`  ${new Date(item.publishedAt).toISOString()}`);
      console.log('');
    }
  }

  if (output) {
    const outputPath = resolve(output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`Saved to: ${outputPath}`);
  }
}

main().catch((e) => {
  console.error(`GAGAL: ${e?.message || e}`);
  process.exit(1);
});