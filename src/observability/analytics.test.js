import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createManualAnalytics, observeCoreWebVitals, startManualAnalytics } from './analytics.js'

function fakeRouter() {
  let rendered
  let subscribeCount = 0
  let unsubscribeCount = 0
  return {
    subscribe(type, handler) {
      expect(type).toBe('onRendered')
      subscribeCount += 1
      rendered = handler
      return () => { unsubscribeCount += 1 }
    },
    render(toLocation, details = {}) {
      rendered({
        type: 'onRendered',
        toLocation: typeof toLocation === 'string' ? { href: toLocation } : toLocation,
        pathChanged: false,
        hrefChanged: false,
        hashChanged: false,
        ...details,
      })
    },
    get unsubscribeCount() {
      return unsubscribeCount
    },
    get subscribeCount() {
      return subscribeCount
    },
  }
}

function readyTarget() {
  return { location: { origin: 'https://kwamina.fyi' } }
}

describe('manual analytics controller', () => {
  it('registers the approved core web vitals through the injected importer', async () => {
    const registrations = []
    const report = () => {}

    await observeCoreWebVitals(report, async () => ({
      onCLS: (callback) => registrations.push(['CLS', callback]),
      onINP: (callback) => registrations.push(['INP', callback]),
      onLCP: (callback) => registrations.push(['LCP', callback]),
    }))

    expect(registrations).toEqual([
      ['CLS', report],
      ['INP', report],
      ['LCP', report],
    ])
  })

  it('starts site analytics after router creation and before React rendering', () => {
    const source = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')
    const routerCreation = source.indexOf('const router = createRouter(')
    const analyticsStart = source.indexOf('startManualAnalytics({')
    const reactRendering = source.indexOf("createRoot(document.getElementById('root'))")

    expect(routerCreation).toBeGreaterThan(-1)
    expect(analyticsStart).toBeGreaterThan(routerCreation)
    expect(reactRendering).toBeGreaterThan(analyticsStart)
  })

  it('records canonical rendered routes once per consecutive route', () => {
    const views = []
    const router = fakeRouter()
    const analytics = startManualAnalytics({
      router,
      provider: {
        recordPageView: (event) => views.push(event),
        recordWebVital() {},
      },
      providerReady: true,
      environment: 'production',
      target: readyTarget(),
    })

    router.render('/about?private=yes#contact')
    router.render('/about/')
    router.render('/about', { pathChanged: true })
    router.render('/work/local-first-pos')
    router.render('/about')

    expect(analytics.enabled).toBe(true)
    expect(views).toEqual([
      { route: '/about' },
      { route: '/work/athena/local-first-pos' },
      { route: '/about' },
    ])
  })

  it('drops unknown routes without forwarding raw input', () => {
    const payloads = []
    const analytics = createManualAnalytics({
      provider: {
        recordPageView: (event) => payloads.push(event),
        recordWebVital: (event) => payloads.push(event),
      },
    })

    expect(analytics.recordPageView('/not-real/private-value?token=secret')).toBe(false)
    expect(payloads).toEqual([])
  })

  it('enables only for the exact production origin and a complete ready provider', () => {
    const provider = { recordPageView() {}, recordWebVital() {} }
    const cases = [
      { environment: 'preview', providerReady: true, target: readyTarget(), provider },
      { environment: 'production', providerReady: false, target: readyTarget(), provider },
      { environment: 'production', providerReady: true, target: { location: { origin: 'https://www.kwamina.fyi' } }, provider },
      { environment: 'production', providerReady: true, target: readyTarget(), provider: { recordPageView() {} } },
    ]

    for (const options of cases) {
      const router = fakeRouter()
      const analytics = startManualAnalytics({ router, ...options })
      expect(analytics.enabled).toBe(false)
      expect(router.subscribeCount).toBe(0)
    }
  })

  it('fails open after synchronous throws and rejected transports without retrying a view', async () => {
    const attempts = []
    const analytics = createManualAnalytics({
      provider: {
        recordPageView({ route }) {
          attempts.push(route)
          if (route === '/about') throw new Error('transport unavailable')
          if (route === '/work/athena') return Promise.reject(new Error('async transport unavailable'))
        },
        recordWebVital() {},
      },
    })

    expect(() => analytics.recordPageView('/about')).not.toThrow()
    expect(analytics.recordPageView('/about')).toBe(false)
    expect(() => analytics.recordPageView('/work/athena')).not.toThrow()
    await Promise.resolve()
    expect(analytics.recordPageView('/')).toBe(true)
    expect(attempts).toEqual(['/about', '/work/athena', '/'])
  })

  it('observes approved web vitals once and attributes them to the initial route', () => {
    const views = []
    const vitals = []
    let reportMetric
    let observeCount = 0
    const router = fakeRouter()
    startManualAnalytics({
      router,
      provider: {
        recordPageView: (event) => views.push(event),
        recordWebVital: (event) => vitals.push(event),
      },
      providerReady: true,
      environment: 'production',
      target: readyTarget(),
      observeVitals(callback) {
        observeCount += 1
        reportMetric = callback
      },
    })

    router.render('/about')
    router.render('/work/athena')
    reportMetric({ name: 'CLS', value: 0.12356, rating: 'good', id: 'private-id', navigationType: 'navigate' })
    reportMetric({ name: 'CLS', value: 0.9, rating: 'poor' })
    reportMetric({ name: 'FID', value: 10, rating: 'good' })
    reportMetric({ name: 'INP', value: Number.POSITIVE_INFINITY, rating: 'poor' })
    reportMetric({ name: 'INP', value: -1, rating: 'poor' })
    reportMetric({ name: 'INP', value: 10, rating: 'excellent' })
    reportMetric({ name: 'INP', value: 100_000_000, rating: 'poor', attribution: { private: true } })
    reportMetric({ name: 'LCP', value: 1234.56789, rating: 'needs-improvement', url: 'https://private.example' })

    expect(observeCount).toBe(1)
    expect(views).toEqual([{ route: '/about' }, { route: '/work/athena' }])
    expect(vitals).toEqual([
      { route: '/about', name: 'CLS', value: 0.124, rating: 'good' },
      { route: '/about', name: 'INP', value: 86_400_000, rating: 'poor' },
      { route: '/about', name: 'LCP', value: 1234.568, rating: 'needs-improvement' },
    ])
  })

  it('contains observer failures and cleanup unsubscribes every active observer', async () => {
    const router = fakeRouter()
    let cleanVitals = 0
    let resolveCleanup
    const analytics = startManualAnalytics({
      router,
      provider: { recordPageView() {}, recordWebVital() {} },
      providerReady: true,
      environment: 'production',
      target: readyTarget(),
      observeVitals: () => new Promise((resolve) => { resolveCleanup = resolve }),
    })

    router.render('/about')
    analytics.cleanup()
    resolveCleanup(() => { cleanVitals += 1 })
    await Promise.resolve()

    expect(router.unsubscribeCount).toBe(1)
    expect(cleanVitals).toBe(1)

    const rejectingRouter = fakeRouter()
    const rejecting = startManualAnalytics({
      router: rejectingRouter,
      provider: { recordPageView() {}, recordWebVital() {} },
      providerReady: true,
      environment: 'production',
      target: readyTarget(),
      observeVitals: () => Promise.reject(new Error('observer import failed')),
    })
    expect(() => rejectingRouter.render('/about')).not.toThrow()
    await Promise.resolve()
    expect(() => rejecting.cleanup()).not.toThrow()

    const throwingRouter = fakeRouter()
    startManualAnalytics({
      router: throwingRouter,
      provider: { recordPageView() {}, recordWebVital() {} },
      providerReady: true,
      environment: 'production',
      target: readyTarget(),
      observeVitals: () => { throw new Error('observer registration failed') },
    })
    expect(() => throwingRouter.render('/about')).not.toThrow()
  })
})
