import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { registerServiceWorker } from './pwa.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const worker = read('public/sw.js');
const main = read('src/main.js');
const html = read('index.html');

test('no worker is registered where the runtime has none', () => {
  // Node exposes a `navigator` object, but never a serviceWorker container.
  assert.equal(registerServiceWorker(), null);
});

test('the application registers the worker on load', () => {
  assert.match(main, /import \{ registerServiceWorker \} from '\.\/pwa\.js';/);
  assert.match(main, /registerServiceWorker\(\);/);
});

test('the manifest the worker serves is still linked', () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(worker, /'\.\/manifest\.webmanifest'/);
});

test('a provider tile is never served from the cache', () => {
  // The globe is imagery and terrain from elsewhere; caching it would serve a
  // stale planet as if it were current.
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return;/);
});

test('the local layer is answered network first with a cached fallback', () => {
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/godseye\/'\)/);
  assert.match(worker, /event\.respondWith\(networkFirst\(request, LOCAL_CACHE\)\)/);
});

test('a navigation falls back to the cached shell', () => {
  assert.match(worker, /if \(request\.mode === 'navigate'\)/);
  assert.match(worker, /cache\.match\('\.\/index\.html'\)/);
});

test('a new version clears the caches of the old one', () => {
  assert.match(worker, /const VERSION = 'gev-v1';/);
  assert.match(worker, /keys\s*\.filter\(\(key\) => !key\.startsWith\(VERSION\)\)/);
});
