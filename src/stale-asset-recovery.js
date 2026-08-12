const STALE_ASSET_RELOAD_KEY = 'kwamina-fyi-stale-asset-reload'
const STALE_ASSET_RELOAD_WINDOW_MS = 60_000

export function installStaleAssetRecovery({
  target = globalThis.window,
  storage,
  now = Date.now,
} = {}) {
  if (!target?.addEventListener || typeof target?.location?.reload !== 'function') {
    return () => {}
  }

  const onPreloadError = (event) => {
    try {
      const reloadStorage = storage ?? target.sessionStorage
      if (!reloadStorage) return

      const timestamp = now()
      const storedTimestamp = reloadStorage.getItem(STALE_ASSET_RELOAD_KEY)
      const lastReload = storedTimestamp === null ? Number.NaN : Number(storedTimestamp)

      if (Number.isFinite(lastReload) && timestamp - lastReload < STALE_ASSET_RELOAD_WINDOW_MS) {
        return
      }

      reloadStorage.setItem(STALE_ASSET_RELOAD_KEY, String(timestamp))

      event?.preventDefault?.()
      target.location.reload()
    } catch {
      // Let the original import failure reach the existing error boundary when
      // storage is unavailable; reloading without a guard could loop forever.
    }
  }

  target.addEventListener('vite:preloadError', onPreloadError)
  return () => target.removeEventListener('vite:preloadError', onPreloadError)
}
