import { canonicalRoute, UNRECOGNIZED_ROUTE } from './contract.js'

const PRODUCTION_ORIGIN = 'https://kwamina.fyi'
const WEB_VITAL_NAMES = new Set(['CLS', 'INP', 'LCP'])
const WEB_VITAL_RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const MAX_WEB_VITAL_VALUE = 86_400_000

const disabledAnalytics = Object.freeze({
  enabled: false,
  recordPageView() {
    return false
  },
  cleanup() {},
})

function failOpen(callback) {
  try {
    const result = callback()
    if (result?.then) Promise.resolve(result).catch(() => {})
    return result
  } catch {
    return undefined
  }
}

function safeMetric(metric) {
  if (!WEB_VITAL_NAMES.has(metric?.name)) return null
  if (!WEB_VITAL_RATINGS.has(metric?.rating)) return null
  if (!Number.isFinite(metric?.value) || metric.value < 0) return null
  return {
    name: metric.name,
    value: Math.round(Math.min(metric.value, MAX_WEB_VITAL_VALUE) * 1000) / 1000,
    rating: metric.rating,
  }
}

export function createManualAnalytics({ provider, observeVitals } = {}) {
  if (
    typeof provider?.recordPageView !== 'function'
    || typeof provider?.recordWebVital !== 'function'
  ) return disabledAnalytics

  let lastRoute
  let initialRoute
  let observationStarted = false
  let observationCleanup
  let cleanedUp = false
  const recordedVitals = new Set()

  const recordWebVital = (metric) => {
    if (cleanedUp) return
    const safe = safeMetric(metric)
    if (!safe || recordedVitals.has(safe.name)) return
    recordedVitals.add(safe.name)
    failOpen(() => provider.recordWebVital({ route: initialRoute, ...safe }))
  }

  const retainObservationCleanup = (cleanup) => {
    if (typeof cleanup !== 'function') return
    if (cleanedUp) failOpen(cleanup)
    else observationCleanup = cleanup
  }

  const startVitalsObservation = () => {
    if (observationStarted || typeof observeVitals !== 'function') return
    observationStarted = true
    try {
      const cleanup = observeVitals(recordWebVital)
      if (cleanup?.then) {
        Promise.resolve(cleanup).then(retainObservationCleanup).catch(() => {})
      } else {
        retainObservationCleanup(cleanup)
      }
    } catch {
      // Analytics must never affect application rendering.
    }
  }

  return Object.freeze({
    enabled: true,
    recordPageView(value) {
      if (cleanedUp) return false
      const route = canonicalRoute(value)
      if (route === UNRECOGNIZED_ROUTE || route === lastRoute) return false

      lastRoute = route
      initialRoute ??= route
      failOpen(() => provider.recordPageView({ route }))
      startVitalsObservation()
      return true
    },
    cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      if (observationCleanup) failOpen(observationCleanup)
    },
  })
}

function ready({ router, provider, providerReady, environment, target }) {
  return environment === 'production'
    && target?.location?.origin === PRODUCTION_ORIGIN
    && providerReady === true
    && typeof router?.subscribe === 'function'
    && typeof provider?.recordPageView === 'function'
    && typeof provider?.recordWebVital === 'function'
}

export function startManualAnalytics(options = {}) {
  if (!ready(options)) return disabledAnalytics

  const analytics = createManualAnalytics(options)
  let unsubscribe
  try {
    unsubscribe = options.router.subscribe('onRendered', (event) => {
      analytics.recordPageView(event?.toLocation?.href ?? event?.toLocation?.pathname)
    })
  } catch {
    analytics.cleanup()
    return disabledAnalytics
  }

  let cleanedUp = false
  return Object.freeze({
    enabled: true,
    recordPageView: analytics.recordPageView,
    cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      failOpen(unsubscribe)
      analytics.cleanup()
    },
  })
}
