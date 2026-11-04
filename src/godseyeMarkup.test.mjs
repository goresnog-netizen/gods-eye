import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { expandApplicationHtml } from '../build/application-html.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const html = expandApplicationHtml(read('index.html'));
const panel = read('src/ui/godseyePanel.js');
const shellElements = read('src/ui/shellElements.js');
const shell = read('src/ui/applicationShell.js');
const css = read('src/ui/styles/godseye.css');

const TABS = [
  ['latest', 'LATEST'],
  ['news', 'NEWS'],
  ['place', 'PLACE'],
  ['vision', 'VISION'],
  ['cctv', 'CCTV'],
  ['locate', 'LOCATE'],
];

test('every God’s Eye tab points at the pane it owns', () => {
  for (const [name, label] of TABS) {
    assert.match(
      html,
      new RegExp(
        `<button id="godseye-tab-${name}"[^>]*aria-controls="godseye-pane-${name}"[^>]*data-i18n>${label}</button>`,
      ),
      `${name} tab is declared with its label`,
    );
    assert.match(
      html,
      new RegExp(`id="godseye-pane-${name}"[^>]*aria-labelledby="godseye-tab-${name}"`),
      `${name} pane is labelled by its tab`,
    );
  }
});

test('only the first pane starts visible', () => {
  assert.doesNotMatch(html, /id="godseye-pane-latest"[^>]*hidden/);
  for (const [name] of TABS.slice(1)) {
    assert.match(html, new RegExp(`id="godseye-pane-${name}"[^>]*hidden`));
  }
});

test('the CCTV tab offers a scan point, a type filter and a radius', () => {
  assert.match(html, /id="godseye-cctv-input"/);
  assert.match(html, /id="godseye-cctv-btn"[^>]*data-i18n>SCAN</);
  assert.match(html, /id="godseye-cctv-type"/);
  for (const type of ['', 'fixed', 'phone', 'ip-camera']) {
    assert.match(html, new RegExp(`<option value="${type}"`));
  }
  assert.match(html, /id="godseye-cctv-radius"/);
  assert.match(html, /id="godseye-cctv-list"/);
  assert.match(html, /id="godseye-cctv-status"[^>]*aria-live="polite"/);
});

test('the target tab reports a position and can fly to it', () => {
  assert.match(html, /id="godseye-locate-input"/);
  assert.match(html, /id="godseye-locate-btn"[^>]*data-i18n>LOCATE</);
  assert.match(html, /id="godseye-locate-name"/);
  assert.match(html, /id="godseye-locate-coords"/);
  assert.match(html, /id="godseye-locate-note"/);
  assert.match(html, /id="godseye-locate-fly"[^>]*data-i18n>FLY TO</);
  assert.match(html, /id="godseye-locate-status"[^>]*aria-live="polite"/);
});

test('the shell reads and passes every new element', () => {
  const elements = [
    ['_godseyeTabNews', 'godseye-tab-news'],
    ['_godseyePaneNews', 'godseye-pane-news'],
    ['_godseyeNewsRegion', 'godseye-news-region'],
    ['_godseyeNewsQuery', 'godseye-news-query'],
    ['_godseyeNewsTopics', 'godseye-news-topics'],
    ['_godseyeNewsBtn', 'godseye-news-btn'],
    ['_godseyeNewsList', 'godseye-news-list'],
    ['_godseyeNewsStatus', 'godseye-news-status'],
    ['_godseyeTabCctv', 'godseye-tab-cctv'],
    ['_godseyePaneCctv', 'godseye-pane-cctv'],
    ['_godseyeCctvInput', 'godseye-cctv-input'],
    ['_godseyeCctvBtn', 'godseye-cctv-btn'],
    ['_godseyeCctvType', 'godseye-cctv-type'],
    ['_godseyeCctvRadius', 'godseye-cctv-radius'],
    ['_godseyeCctvList', 'godseye-cctv-list'],
    ['_godseyeCctvStatus', 'godseye-cctv-status'],
    ['_godseyeTabLocate', 'godseye-tab-locate'],
    ['_godseyePaneLocate', 'godseye-pane-locate'],
    ['_godseyeLocateInput', 'godseye-locate-input'],
    ['_godseyeLocateBtn', 'godseye-locate-btn'],
    ['_godseyeLocateCard', 'godseye-locate-card'],
    ['_godseyeLocateName', 'godseye-locate-name'],
    ['_godseyeLocateCoords', 'godseye-locate-coords'],
    ['_godseyeLocateNote', 'godseye-locate-note'],
    ['_godseyeLocateFly', 'godseye-locate-fly'],
    ['_godseyeLocateNetwork', 'godseye-locate-network'],
    ['_godseyeLocateGeo', 'godseye-locate-geo'],
    ['_godseyeLocateNetworkBtn', 'godseye-locate-network-btn'],
    ['_godseyeLocateConsent', 'godseye-locate-consent'],
    ['_godseyeLocateConsentRequest', 'godseye-locate-consent-request'],
    ['_godseyeLocateConsentLink', 'godseye-locate-consent-link'],
    ['_godseyeLocateConsentCopy', 'godseye-locate-consent-copy'],
    ['_godseyeLocateConsentStatus', 'godseye-locate-consent-status'],
    ['_godseyeLocateList', 'godseye-locate-list'],
    ['_godseyeLocateStatus', 'godseye-locate-status'],
    ['_godseyeLive', 'godseye-live'],
  ];
  for (const [key, id] of elements) {
    assert.match(
      shellElements,
      new RegExp(`${key}: document\\.getElementById\\(\\s*'${id}'\\s*,?\\s*\\)`),
      `${key} reads #${id}`,
    );
    assert.match(
      shell,
      new RegExp(`${key}: this\\.${key},`),
      `${key} reaches the panel`,
    );
  }
});

test('the panel selects every tab and handles the new actions', () => {
  for (const [name] of TABS) {
    assert.match(panel, new RegExp(`\\['${name}', _godseye`), `${name} is in the tab table`);
  }
  assert.match(panel, /_godseyeCctvBtn\?\.addEventListener\('click'/);
  assert.match(panel, /_godseyeLocateBtn\?\.addEventListener\('click'/);
  assert.match(panel, /_godseyeLocateFly\?\.addEventListener\('click'/);
  assert.match(panel, /_godseyeBtsViewshedBtn\?\.addEventListener\('click'/);
  // Enter in any field runs the same action as its button: place, CCTV,
  // target, terrain, world-news query, network-context point.
  assert.equal(
    (panel.match(/if \(event\.key !== 'Enter'\) return;/g) || []).length,
    6,
    'every field with a button submits on Enter',
  );
});

test('a located point flies the globe directly instead of through the geocoder', () => {
  assert.match(shell, /flyToPoint: \(lat, lon, altitude = 2000\) => \{/);
  assert.match(shell, /destination: Cesium\.Cartesian3\.fromDegrees\(lon, lat, height\)/);
  assert.match(panel, /_flyToLocated\(altitude\) \{/);
  // The automatic flight is the point of the tab: locating answers where it is.
  assert.match(panel, /this\._flyToLocated\(\);/);
});

test('the CCTV rows are buttons that fly to their camera', () => {
  assert.match(panel, /button\.className = 'godseye-camera'/);
  assert.match(panel, /this\.flyToPoint\?\.\(camera\.lat, camera\.lon, 1200\)/);
  assert.match(css, /\.godseye-camera:hover:not\(:disabled\)/);
  // Seven modes have to fit a narrow rail. Wrapping was the old answer and it
  // broke into ragged rows; a fixed four-column grid is the current one.
  assert.match(css, /\.godseye-tabs \{[^}]*grid-template-columns: repeat\(4,/);
  assert.doesNotMatch(css, /\.godseye-tabs \{[^}]*flex-wrap/);
});

test('the target tab reports the stored track', () => {
  assert.match(panel, /const track = payload\?\.track;/);
  for (const key of ['FIXES', 'DISTANCE', 'AVG SPEED', 'ANOMALIES']) {
    assert.match(panel, new RegExp(`t\\('${key}'\\)`), `${key} is labelled`);
  }
});

test('the target tab says how near the point is to a cell site', () => {
  assert.ok(panel.includes("t('NEAREST BTS')"), 'the nearest site is labelled');
  assert.ok(
    panel.includes('`${bts.coveragePct}%`'),
    'coverage is a share of the site range',
  );
  // A seed site is never shown as if it were an operator one.
  assert.ok(panel.includes("if (bts?.synthetic) parts.push(t('SYNTHETIC'));"));
});

test('a target is identified by handle as well as by phone', () => {
  assert.match(panel, /\[t\('USERNAME'\), payload\?\.target\?\.username \|\| '—'\]/);
  assert.match(html, /placeholder="Name, @handle, phone or 510-10-12345-67890"/);
});

test('the news tab reads the local artifact for one region', () => {
  assert.match(html, /id="godseye-news-region"/);
  assert.match(html, /<option value="papua" data-i18n>PAPUA<\/option>/);
  assert.match(html, /<option value="indonesia" data-i18n>INDONESIA<\/option>/);
  assert.match(panel, /const NEWS_ENDPOINT = '\/api\/godseye\/news';/);
  assert.match(panel, /if \(!this\._newsLoaded\) this\._loadNews\(\);/);
  assert.match(css, /\.godseye-news-title/);
});

test('the live badge follows the server stream and stops with the panel', () => {
  assert.match(
    html,
    /<p id="godseye-live" class="godseye-live" role="status" aria-live="polite"><\/p>/,
  );
  assert.match(panel, /const STREAM_ENDPOINT = '\/api\/godseye\/stream';/);
  assert.match(panel, /new EventSource\(STREAM_ENDPOINT\)/);
  assert.match(panel, /_stopLive\(\) \{/);
  // The stream is opened once on connect and closed on destroy.
  assert.match(panel, /this\._startLive\(\);/);
  assert.match(panel, /this\._stopLive\(\);/);
  assert.match(css, /\.godseye-live\.is-live/);
});
