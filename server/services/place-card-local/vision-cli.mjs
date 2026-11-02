#!/usr/bin/env node
/**
 * Vision Papua CLI — lokal, tanpa external provider calls.
 *
 *   node server/services/place-card-local/vision-cli.mjs
 *   node server/services/place-card-local/vision-cli.mjs --area "Tolikara" --json
 *   node server/services/place-card-local/vision-cli.mjs --all --output src/data/vision-papua.json
 */

import {
  generateVisionOutput,
  generateAllPapuaVision,
  getArea,
  PAPUA_AREAS,
} from './vision-papua.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

async function main() {
  const areaQuery = arg('area', null);
  const all = Boolean(arg('all', false));
  const json = Boolean(arg('json', false));
  const output = arg('output', null);

  if (all) {
    const results = generateAllPapuaVision();
    if (json) console.log(JSON.stringify(results, null, 2));
    else {
      console.log(`Vision Papua — ${results.length} areas`);
      for (const r of results) {
        console.log(
          `  ${r.area.name}: ${r.summary.people_count} orang, ${r.summary.vehicle_count} kendaraan`,
        );
      }
    }
    if (output) {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(resolve(output), JSON.stringify(results, null, 2));
      console.log(`Saved to: ${resolve(output)}`);
    }
    return;
  }

  if (areaQuery) {
    const area = getArea(areaQuery);
    if (!area) {
      console.log(`Area "${areaQuery}" tidak ditemukan.`);
      console.log('Available:', PAPUA_AREAS.map((a) => a.name).join(', '));
      process.exit(1);
    }
    const result = generateVisionOutput(area);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Vision: ${result.area.name}`);
      console.log(`  Scene: ${result.scene.description}`);
      console.log(
        `  Orang: ${result.summary.people_count}, Kendaraan: ${result.summary.vehicle_count}`,
      );
      console.log(
        `  Visibility: ${result.scene.visibility}, Time: ${result.scene.time_of_day}`,
      );
    }
    if (output) {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(resolve(output), JSON.stringify(result, null, 2));
      console.log(`Saved to: ${resolve(output)}`);
    }
    return;
  }

  // Default: list areas
  console.log('Vision Papua Areas:');
  for (const a of PAPUA_AREAS) {
    console.log(
      `  ${a.id}: ${a.name} (${a.lat}, ${a.lon}) — ${a.terrain}, ${a.elevation_m}m`,
    );
  }
  console.log(
    '\nUsage: node vision-cli.mjs --area "Tolikara" --json | --all --output file.json',
  );
}

main().catch((e) => {
  console.error(`GAGAL: ${e?.message || e}`);
  process.exit(1);
});
