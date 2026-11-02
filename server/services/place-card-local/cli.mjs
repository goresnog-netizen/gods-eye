#!/usr/bin/env node
/**
 * Local Place Card CLI — end-to-end, no external provider calls.
 *
 *   node server/services/place-card-local/cli.mjs "Jakarta"
 *   node server/services/place-card-local/cli.mjs "Papua" --json
 *   node server/services/place-card-local/cli.mjs "Surabaya" --radius 50
 */

import { buildPlaceCard } from './build-place-card.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

function parseArgs() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  return {
    query: positional[0] || 'Jakarta',
    json: Boolean(arg('json', false)),
    radiusKm: Number(arg('radius', 25)) || 25,
    output: arg('output', null),
  };
}

async function main() {
  const opts = parseArgs();
  const card = await buildPlaceCard(opts.query, { radiusKm: opts.radiusKm });

  if (opts.json) {
    console.log(JSON.stringify(card, null, 2));
  } else {
    console.log(`Place Card: ${card.query}`);
    console.log(`  Name:    ${card.place.name}`);
    console.log(`  Lat/Lon: ${card.place.lat}, ${card.place.lon}`);
    console.log(`  Radius:  ${card.radiusKm} km`);
    console.log(
      `  Photo:   ${card.photo.available ? 'available' : 'not available'}`,
    );
    console.log(`  Source:  ${card.source}`);
    console.log(`  Intent:  ${card.intent.tool}`);
  }

  if (opts.output) {
    const outputPath = resolve(opts.output);
    const dir = dirname(outputPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(card, null, 2));
    console.log(`\nSaved to: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(`GAGAL: ${error?.message || error}`);
  process.exit(1);
});
