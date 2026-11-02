/**
 * Phone Tracker OSINT — Real phone number lookup via API.
 *
 * Requires API key (free tier available):
 * - NumVerify: https://numverify.com (1000 lookups/month free)
 * - AbstractAPI: https://abstractapi.com/phone-lookup (100/month free)
 *
 * Constraint: Data stays LOCAL. Only sends phone number to API provider,
 * receives location data back. No data sent to other external services.
 *
 * Usage:
 *   export PHONE_TRACKER_API_KEY=your_key
 *   node phone-tracker.mjs --phone "+62-812-3456-7890"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_KEY =
  process.env.PHONE_TRACKER_API_KEY || process.env.NUMVERIFY_API_KEY || '';
const DEFAULT_API = process.env.PHONE_TRACKER_API || 'numverify'; // numverify | abstractapi

// Cache file for offline access
const CACHE_DIR = resolve(__dirname, '../../../src/data/place-card-results');
const CACHE_FILE = resolve(CACHE_DIR, 'phone-cache.json');

/**
 * Parse phone number to get country code
 */
function parsePhone(phone) {
  // Clean phone number
  const cleaned = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');

  // Extract country code
  let countryCode = '62'; // Default Indonesia
  let number = cleaned;

  if (cleaned.startsWith('62')) {
    countryCode = '62';
    number = cleaned.substring(2);
  } else if (cleaned.startsWith('8') && cleaned.length >= 10) {
    // Indonesian phone without country code (e.g., 812-3456-7890)
    countryCode = '62';
    number = cleaned; // Keep as-is for API
  } else if (cleaned.startsWith('1') && cleaned.length === 11) {
    // US/Canada
    countryCode = '1';
    number = cleaned.substring(1);
  } else if (cleaned.length <= 4) {
    // Short number, can't lookup
    throw new Error('Nomor terlalu pendek untuk di-lookup');
  }

  return { countryCode, number, full: `+${countryCode}${number}` };
}

/**
 * Lookup phone via NumVerify API
 */
async function lookupNumVerify(phone) {
  if (!API_KEY)
    throw new Error(
      'NumVerify API key required. Set PHONE_TRACKER_API_KEY or NUMVERIFY_API_KEY',
    );

  const { full } = parsePhone(phone);
  const url = `http://api.numverify.com/?phone_number=${encodeURIComponent(full)}&apikey=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`NumVerify error: ${res.status}`);

  const data = await res.json();

  if (!data.valid) {
    throw new Error('Nomor tidak valid');
  }

  return {
    valid: true,
    number: data.number,
    country: data.country_name,
    countryCode: data.country_code,
    location: data.location,
    carrier: data.carrier,
    lineType: data.line_type,
    lat: data.latitude,
    lon: data.longitude,
  };
}

/**
 * Lookup phone via AbstractAPI
 */
async function lookupAbstractAPI(phone) {
  if (!API_KEY)
    throw new Error('AbstractAPI key required. Set PHONE_TRACKER_API_KEY');

  const { full } = parsePhone(phone);
  const url = `https://phonevalidation.abstractapi.com/v1/?api_key=${API_KEY}&phone=${encodeURIComponent(full)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`AbstractAPI error: ${res.status}`);

  const data = await res.json();

  if (data.error) throw new Error(data.error.message || 'API error');

  return {
    valid: data.valid,
    number: data.phone,
    country: data.country.name,
    countryCode: data.country.code,
    location: data.location,
    carrier: data.carrier?.name,
    lineType: data.line_type,
    lat: data.geocode?.latitude,
    lon: data.geocode?.longitude,
  };
}

/**
 * Main lookup function
 */
export async function lookupPhone(phone, api = DEFAULT_API) {
  const cache = loadCache();
  const cacheKey = `${api}:${phone}`;

  // Check cache first (24 hour TTL)
  if (cache[cacheKey] && cache[cacheKey].timestamp > Date.now() - 86400000) {
    console.log(`[CACHE] ${phone} -> ${cache[cacheKey].location}`);
    return { ...cache[cacheKey], source: 'cache' };
  }

  let result;
  try {
    if (api === 'abstractapi') {
      result = await lookupAbstractAPI(phone);
    } else {
      result = await lookupNumVerify(phone);
    }
    result.source = api;
    result.timestamp = Date.now();

    // Cache result
    cache[cacheKey] = result;
    saveCache(cache);

    console.log(`[OK] ${phone} -> ${result.location}, ${result.country}`);
    return result;
  } catch (e) {
    console.error(`[ERROR] ${phone}: ${e.message}`);
    throw e;
  }
}

/**
 * Load cache from disk
 */
function loadCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[CACHE] Load error:', e.message);
  }
  return {};
}

/**
 * Save cache to disk
 */
function saveCache(cache) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[CACHE] Save error:', e.message);
  }
}

/**
 * CLI
 */
async function main() {
  const args = process.argv.slice(2);
  let phone = '';
  let api = DEFAULT_API;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phone' && args[i + 1]) {
      phone = args[i + 1];
      i++;
    } else if (args[i] === '--api' && args[i + 1]) {
      api = args[i + 1];
      i++;
    } else if (args[i] === '--key' && args[i + 1]) {
      process.env.PHONE_TRACKER_API_KEY = args[i + 1];
      i++;
    } else if (args[i] === '--cache') {
      const cache = loadCache();
      console.log('📦 Cache:', Object.keys(cache).length, 'entries');
      Object.entries(cache).forEach(([k, v]) => {
        console.log(
          `  ${k}: ${v.location || 'N/A'} (${new Date(v.timestamp).toISOString().slice(0, 10)})`,
        );
      });
      return;
    } else if (args[i] === '--clear-cache') {
      saveCache({});
      console.log('🗑️ Cache cleared');
      return;
    }
  }

  if (!phone) {
    console.log(
      'Usage: node phone-tracker.mjs --phone "+62-812-3456-7890" [--api numverify|abstractapi] [--key API_KEY]',
    );
    console.log('');
    console.log('Options:');
    console.log('  --phone <number>    Phone number to lookup');
    console.log(
      '  --api <provider>    API provider: numverify (default) or abstractapi',
    );
    console.log(
      '  --key <key>         API key (or set PHONE_TRACKER_API_KEY env)',
    );
    console.log('  --cache             Show cache contents');
    console.log('  --clear-cache       Clear cache');
    console.log('');
    console.log('Free API tiers:');
    console.log('  - NumVerify: 1000 lookups/month (https://numverify.com)');
    console.log('  - AbstractAPI: 100 lookups/month (https://abstractapi.com)');
    console.log('');
    console.log('Example:');
    console.log('  export PHONE_TRACKER_API_KEY=your_key_here');
    console.log('  node phone-tracker.mjs --phone "+62-812-3456-7890"');
    return;
  }

  if (!API_KEY) {
    console.error('❌ API key required!');
    console.error('   Set PHONE_TRACKER_API_KEY or NUMVERIFY_API_KEY env');
    console.error('   Or use --key parameter');
    process.exit(1);
  }

  try {
    const result = await lookupPhone(phone, api);
    console.log('\n📱 Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('❌ Failed:', e.message);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('phone-tracker.mjs')) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

export { parsePhone, loadCache, saveCache };
