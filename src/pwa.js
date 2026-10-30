/**
 * Register the service worker that keeps the shell and the local layer
 * available offline.
 *
 * Production only: in development a cache in front of Vite would serve a
 * stale module and hide exactly the edits being made. The worker itself
 * (`public/sw.js`) refuses to cache anything cross-origin, so provider tiles
 * are never served from a cache.
 */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  // `import.meta.env` is a Vite global; under plain node it is absent.
  const env = import.meta.env || {};
  if (!env.PROD) return null;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* An unavailable worker is not an application error. */
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
  return true;
}
