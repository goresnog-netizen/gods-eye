/**
 * Where the data came from, in the form a licence requires it.
 *
 * Three of the sources behind this console are share-alike: OpenCelliD
 * (CC BY-SA 4.0), OpenStreetMap (ODbL) and KartaView (CC BY-SA 4.0). Their
 * licences do not ask for a link in a README — they ask for the credit to
 * travel with the data, which means inside every export and on every response
 * that carries it.
 *
 * So the credit is not a setting. `attributionFor()` is the only way to build
 * an export, the strings are emitted in the body where a consumer cannot strip
 * them, and the same text goes out as headers for clients that only read those.
 */

export const ATTRIBUTIONS = Object.freeze({
  opencellid: {
    id: 'opencellid',
    name: 'OpenCelliD',
    license: 'CC BY-SA 4.0',
    url: 'https://opencellid.org',
    text:
      'Cell tower data © OpenCelliD (https://opencellid.org), licensed CC BY-SA 4.0. ' +
      'Derived exports must carry the same licence.',
  },
  osm: {
    id: 'osm',
    name: 'OpenStreetMap',
    license: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    text:
      'Mast data © OpenStreetMap contributors, licensed ODbL 1.0. ' +
      'Derived databases must remain open under the same licence.',
  },
  kartaview: {
    id: 'kartaview',
    name: 'KartaView',
    license: 'CC BY-SA 4.0',
    url: 'https://kartaview.org',
    text: 'Street-level imagery © KartaView contributors, licensed CC BY-SA 4.0.',
  },
  local: {
    id: 'local',
    name: "God's Eye local catalogs",
    license: 'internal',
    url: null,
    text: "Local catalogues and derived geometry: God's Eye, for internal use.",
  },
});

/**
 * The credits an export must carry, for the sources it actually contains.
 *
 * An empty list is not allowed: an export with no provenance is worse than no
 * export, so the caller always gets at least the local-catalogue credit.
 */
export function attributionFor(sources = []) {
  const keys = [...new Set([...(sources || []), 'local'])];
  const chosen = keys.map((key) => ATTRIBUTIONS[key]).filter(Boolean);
  return {
    entries: chosen,
    texts: chosen.map((entry) => entry.text),
    licenses: [...new Set(chosen.map((entry) => entry.license))],
    // One line, for a header or a KML description.
    summary: chosen
      .map((entry) => `${entry.name} (${entry.license})`)
      .join(' · '),
  };
}

/** Which sources a scope touches — the export route's own knowledge, in one place. */
export function sourcesForScope(scope) {
  if (scope === 'bts') return ['opencellid'];
  if (scope === 'cctv' || scope === 'vision') return ['local'];
  if (scope === 'targets') return ['local'];
  return ['opencellid', 'local'];
}
