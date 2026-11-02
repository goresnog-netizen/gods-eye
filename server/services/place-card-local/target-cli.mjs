#!/usr/bin/env node
/**
 * Target Tracker CLI — lokal, tanpa external provider calls.
 *
 *   node server/services/place-card-local/target-cli.mjs "Target Papua 1"
 *   node server/services/place-card-local/target-cli.mjs "+62-812-3456-7890"
 *   node server/services/place-card-local/target-cli.mjs "Jayapura" --region papua
 */

import {
  buildTargetProfile,
  resolveTarget,
  getTargetsByRegion,
} from './target-tracker.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const query = positional[0];
  const region = arg('region', null);
  const json = Boolean(arg('json', false));
  const output = arg('output', null);

  if (region) {
    const result = await getTargetsByRegion(region);
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Targets in ${region}: ${result.count}`);
    if (output) {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(resolve(output), JSON.stringify(result, null, 2));
      console.log(`Saved to: ${resolve(output)}`);
    }
    return;
  }

  if (!query) {
    console.log(
      'Usage: node target-cli.mjs <query> [--region papua] [--json] [--output file]',
    );
    process.exit(1);
  }

  const profile = await buildTargetProfile(query);
  if (json) console.log(JSON.stringify(profile, null, 2));
  else {
    if (profile.found === false) {
      console.log(`GAGAL: ${profile.reason}`);
      process.exit(1);
    }
    console.log(`Target: ${profile.target.name}`);
    console.log(`  Phone: ${profile.target.phone}`);
    console.log(`  City:  ${profile.target.city}`);
    console.log(`  Lat/Lon: ${profile.target.lat}, ${profile.target.lon}`);
    console.log(`  CCTV: ${profile.cctv.count} kamera nearby`);
  }

  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), JSON.stringify(profile, null, 2));
    console.log(`Saved to: ${resolve(output)}`);
  }
}

main().catch((e) => {
  console.error(`GAGAL: ${e?.message || e}`);
  process.exit(1);
});
