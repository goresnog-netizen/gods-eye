import { createBtsLayer } from '../../layers/bts/index.js';
import { overlayHost } from './overlayHost.js';

/**
 * Wire the cell-tower layer to the application overlay host.
 *
 * The registry is a local artifact the sweep writes, so there is no provider
 * key to hold and nothing leaves the machine.
 */
export function createApplicationBts(options = {}) {
  return createBtsLayer({ overlayHost, ...options });
}
