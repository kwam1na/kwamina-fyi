import { describe, expect, it } from 'bun:test'
import {
  SIMPLE_ANALYTICS_SCRIPT_CONFIG,
  createSimpleAnalyticsProvider,
  loadSimpleAnalyticsScript,
} from './simple-analytics.js'

const SENTINEL = 'private-analytics-value-4c7e'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function fakeDocument() {
  const appended = []
  return {
    appended,
    createElement(tagName) {
      const attributes = new Map()
      return {
        tagName,
        attributes,
        setAttribute(name, value) {
          attributes.set(name, value)
        },
      }
    },
    head: {
      append(script) {
        appended.push(script)
      },
    },
  }
}

describe('Simple Analytics script loader', () => {
  it('appends the privacy-configured script and resolves only after load', async () => {
    const document = fakeDocument()
    let resolved = false
    const loading = loadSimpleAnalyticsScript(document).then(() => { resolved = true })
    const [script] = document.appended

    expect(Object.isFrozen(SIMPLE_ANALYTICS_SCRIPT_CONFIG)).toBe(true)
    expect(document.appended).toHaveLength(1)
    expect(script.tagName).toBe('script')
    expect(script.src).toBe('https://scripts.simpleanalyticscdn.com/sri/v11.js')
    expect(script.async).toBe(true)
    expect(script.referrerPolicy).toBe('no-referrer')
    expect(script.integrity).toBe(SIMPLE_ANALYTICS_SCRIPT_CONFIG.integrity)
    expect(script.crossOrigin).toBe('anonymous')
    expect(script.attributes.get('data-auto-collect')).toBe('false')
    expect(script.attributes.get('data-ignore-metrics')).toBe(
      'referrer,utm,country,session,timeonpage,scrolled,useragent,screensize,viewportsize,language',
    )
    expect(resolved).toBe(false)

    script.onload()
    await loading
    expect(resolved).toBe(true)
  })

  it('rejects on script errors without appending fallback markup', async () => {
    const document = fakeDocument()
    const loading = loadSimpleAnalyticsScript(document)
    const [script] = document.appended

    script.onerror()

    await expect(loading).rejects.toThrow('Simple Analytics script failed to load')
    expect(document.appended).toEqual([script])
  })
})

describe('Simple Analytics provider adapter', () => {
  it('loads lazily, queues safe events, and drains exact provider calls in FIFO order', async () => {
    const loading = deferred()
    const calls = []
    let loadCount = 0
    const target = {
      sa_loaded: true,
      sa_pageview: (route) => calls.push(['pageview', route]),
      sa_event: (name, payload) => calls.push(['event', name, payload]),
    }
    const provider = createSimpleAnalyticsProvider({
      target,
      loadScript: () => {
        loadCount += 1
        return loading.promise
      },
    })

    expect(loadCount).toBe(0)
    expect(provider.recordPageView({ route: `/about?secret=${SENTINEL}`, extra: SENTINEL })).toBe(true)
    expect(provider.recordWebVital({
      route: '/about#private',
      name: 'CLS',
      value: 0.12356,
      rating: 'good',
      id: SENTINEL,
      referrer: SENTINEL,
    })).toBe(true)
    expect(provider.recordPageView({ route: '/work/local-first-pos' })).toBe(true)
    expect(loadCount).toBe(1)
    expect(calls).toEqual([])

    loading.resolve()
    await settle()

    expect(calls).toEqual([
      ['pageview', '/about'],
      ['event', 'web_vital', {
        route: '/about',
        name: 'CLS',
        value: 0.124,
        rating: 'good',
      }],
      ['pageview', '/work/athena/local-first-pos'],
    ])
    expect(JSON.stringify(calls)).not.toContain(SENTINEL)
  })

  it('retains the initial view when the bounded queue is full', async () => {
    const loading = deferred()
    const calls = []
    const target = {
      sa_loaded: true,
      sa_pageview: (route) => calls.push(route),
      sa_event() {},
    }
    const provider = createSimpleAnalyticsProvider({ target, maxQueue: 2, loadScript: () => loading.promise })

    expect(provider.recordPageView({ route: '/' })).toBe(true)
    expect(provider.recordPageView({ route: '/about' })).toBe(true)
    expect(provider.recordPageView({ route: '/work/athena' })).toBe(false)
    loading.resolve()
    await settle()

    expect(calls).toEqual(['/', '/about'])
  })

  it('rejects invalid and private payloads before loading', () => {
    let loadCount = 0
    const provider = createSimpleAnalyticsProvider({
      target: {},
      loadScript: () => { loadCount += 1 },
    })
    const invalid = [
      () => provider.recordPageView({ route: `/not-real/${SENTINEL}?q=${SENTINEL}` }),
      () => provider.recordPageView({ route: SENTINEL, id: SENTINEL }),
      () => provider.recordWebVital({ route: '/about', name: 'FID', value: 1, rating: 'good' }),
      () => provider.recordWebVital({ route: '/about', name: 'INP', value: -1, rating: 'poor' }),
      () => provider.recordWebVital({ route: '/about', name: 'INP', value: Infinity, rating: 'poor' }),
      () => provider.recordWebVital({ route: '/about', name: 'LCP', value: 10, rating: SENTINEL }),
    ]

    for (const record of invalid) expect(record()).toBe(false)
    expect(loadCount).toBe(0)
  })

  it('bounds and rounds approved web vital values', async () => {
    const calls = []
    const target = {
      sa_loaded: true,
      sa_pageview() {},
      sa_event: (...args) => calls.push(args),
    }
    const provider = createSimpleAnalyticsProvider({ target, loadScript: () => Promise.resolve() })

    provider.recordWebVital({
      route: '/work/athena?private=yes',
      name: 'INP',
      value: 100_000_000.9999,
      rating: 'needs-improvement',
      url: SENTINEL,
    })
    await settle()

    expect(calls).toEqual([['web_vital', {
      route: '/work/athena',
      name: 'INP',
      value: 86_400_000,
      rating: 'needs-improvement',
    }]])
  })

  it('permanently fails open when loading rejects or globals are incomplete', async () => {
    for (const scenario of [
      { target: {}, loadScript: () => { throw new Error('sync load failure') } },
      { target: {}, loadScript: () => Promise.reject(new Error('async load failure')) },
      { target: { sa_loaded: true, sa_pageview() {} }, loadScript: () => Promise.resolve() },
      { target: { sa_loaded: false, sa_pageview() {}, sa_event() {} }, loadScript: () => Promise.resolve() },
    ]) {
      let loadCount = 0
      const provider = createSimpleAnalyticsProvider({
        target: scenario.target,
        loadScript: () => {
          loadCount += 1
          return scenario.loadScript()
        },
      })

      expect(() => provider.recordPageView({ route: '/' })).not.toThrow()
      await settle()
      expect(provider.recordPageView({ route: '/about' })).toBe(false)
      expect(provider.recordWebVital({ route: '/', name: 'LCP', value: 1, rating: 'good' })).toBe(false)
      expect(loadCount).toBe(1)
    }
  })

  it('stops draining after synchronous or asynchronous provider failures', async () => {
    for (const firstCall of [
      () => { throw new Error('sync provider failure') },
      () => Promise.reject(new Error('async provider failure')),
    ]) {
      const loading = deferred()
      const calls = []
      const target = {
        sa_loaded: true,
        sa_pageview(route) {
          calls.push(route)
          if (calls.length === 1) return firstCall()
        },
        sa_event() {},
      }
      const provider = createSimpleAnalyticsProvider({ target, loadScript: () => loading.promise })
      provider.recordPageView({ route: '/' })
      provider.recordPageView({ route: '/about' })
      loading.resolve()
      await settle()

      expect(calls).toEqual(['/'])
      expect(provider.recordPageView({ route: '/work/athena' })).toBe(false)
    }
  })

  it('serializes new ready-state events behind an in-flight queued send', async () => {
    for (const outcome of ['resolve', 'reject']) {
      const loading = deferred()
      const firstSend = deferred()
      const calls = []
      const target = {
        sa_loaded: true,
        sa_pageview(route) {
          calls.push(route)
          if (calls.length === 1) return firstSend.promise
        },
        sa_event() {},
      }
      const provider = createSimpleAnalyticsProvider({ target, loadScript: () => loading.promise })
      provider.recordPageView({ route: '/' })
      provider.recordPageView({ route: '/about' })
      loading.resolve()
      await Promise.resolve()
      await Promise.resolve()

      expect(provider.recordPageView({ route: '/work/athena' })).toBe(true)
      expect(calls).toEqual(['/'])

      if (outcome === 'resolve') firstSend.resolve()
      else firstSend.reject(new Error('in-flight provider failure'))
      await settle()

      expect(calls).toEqual(outcome === 'resolve'
        ? ['/', '/about', '/work/athena']
        : ['/'])
      if (outcome === 'reject') expect(provider.recordPageView({ route: '/about' })).toBe(false)
    }
  })

  it('bounds ready-state events behind a never-settling provider call', async () => {
    const loading = deferred()
    const firstSend = deferred()
    const calls = []
    const target = {
      sa_loaded: true,
      sa_pageview(route) {
        calls.push(route)
        if (calls.length === 1) return firstSend.promise
      },
      sa_event() {},
    }
    const provider = createSimpleAnalyticsProvider({
      target,
      maxQueue: 2,
      loadScript: () => loading.promise,
    })

    expect(provider.recordPageView({ route: '/' })).toBe(true)
    loading.resolve()
    await settle()

    expect(calls).toEqual(['/'])
    expect(provider.recordPageView({ route: '/about' })).toBe(true)
    expect(provider.recordPageView({ route: '/work/athena' })).toBe(true)
    expect(provider.recordPageView({ route: '/work/athena/local-first-pos' })).toBe(false)
    expect(calls).toEqual(['/'])

    firstSend.resolve()
    await settle()
    expect(calls).toEqual(['/', '/about', '/work/athena'])
  })
})
