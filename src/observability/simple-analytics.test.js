import { describe, expect, it } from 'bun:test'
import {
  SIMPLE_ANALYTICS_ENDPOINT,
  createSimpleAnalyticsProvider,
  createSimpleAnalyticsTransport,
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

function productionTarget(overrides = {}) {
  return {
    document: { referrer: '' },
    fetch() {},
    location: { origin: 'https://kwamina.fyi' },
    navigator: {},
    ...overrides,
  }
}

describe('Simple Analytics direct transport', () => {
  it('posts the exact allowlisted envelope without credentials or a referrer', async () => {
    const calls = []
    const target = productionTarget({
      fetch: (...args) => {
        calls.push(args)
        return Promise.resolve({ ok: true })
      },
    })
    const transport = createSimpleAnalyticsTransport({ target })
    const payload = Object.freeze({ type: 'pageview', hostname: 'kwamina.fyi', path: '/about' })

    await transport(payload)

    expect(calls).toEqual([[SIMPLE_ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      keepalive: true,
      referrerPolicy: 'no-referrer',
    }]])
  })

  it('rejects failed responses so the provider can fail open permanently', async () => {
    const transport = createSimpleAnalyticsTransport({
      target: productionTarget({ fetch: () => Promise.resolve({ ok: false }) }),
    })

    await expect(transport({ type: 'pageview' })).rejects.toThrow('Simple Analytics rejected telemetry')
  })
})

describe('Simple Analytics provider adapter', () => {
  it('sends exact pageview and Web Vital payloads in FIFO order', async () => {
    const firstSend = deferred()
    const payloads = []
    const provider = createSimpleAnalyticsProvider({
      target: productionTarget(),
      send(payload) {
        payloads.push(payload)
        if (payloads.length === 1) return firstSend.promise
      },
    })

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
    await settle()

    expect(payloads).toEqual([{
      type: 'pageview',
      hostname: 'kwamina.fyi',
      event: 'pageview',
      path: '/about',
      unique: true,
      https: true,
      ua: 'Kwam-FYI/1.0 (+https://kwamina.fyi/)',
    }])

    firstSend.resolve()
    await settle()

    expect(payloads).toEqual([
      {
        type: 'pageview',
        hostname: 'kwamina.fyi',
        event: 'pageview',
        path: '/about',
        unique: true,
        https: true,
        ua: 'Kwam-FYI/1.0 (+https://kwamina.fyi/)',
      },
      {
        type: 'event',
        hostname: 'kwamina.fyi',
        event: 'web_vital',
        path: '/about',
        ua: 'Kwam-FYI/1.0 (+https://kwamina.fyi/)',
        metadata: { route: '/about', name: 'CLS', value: 0.124, rating: 'good' },
      },
      {
        type: 'pageview',
        hostname: 'kwamina.fyi',
        event: 'pageview',
        path: '/work/athena/local-first-pos',
        unique: false,
        https: true,
        ua: 'Kwam-FYI/1.0 (+https://kwamina.fyi/)',
      },
    ])
    expect(JSON.stringify(payloads)).not.toContain(SENTINEL)
  })

  it('marks only a direct or external document entry as unique', async () => {
    for (const [referrer, expected] of [
      ['', true],
      ['https://search.example/result?q=private', true],
      [`https://kwamina.fyi/about?secret=${SENTINEL}`, false],
    ]) {
      const payloads = []
      const provider = createSimpleAnalyticsProvider({
        target: productionTarget({ document: { referrer } }),
        send: (payload) => payloads.push(payload),
      })

      provider.recordPageView({ route: '/' })
      provider.recordPageView({ route: '/about' })
      await settle()

      expect(payloads.map(({ unique }) => unique)).toEqual([expected, false])
      expect(JSON.stringify(payloads)).not.toContain(referrer || SENTINEL)
    }
  })

  it('rejects invalid and private payloads before sending', async () => {
    const payloads = []
    const provider = createSimpleAnalyticsProvider({
      target: productionTarget(),
      send: (payload) => payloads.push(payload),
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
    await settle()
    expect(payloads).toEqual([])
  })

  it('respects Do Not Track without sending or queueing', async () => {
    const payloads = []
    const provider = createSimpleAnalyticsProvider({
      target: productionTarget({ navigator: { doNotTrack: '1' } }),
      send: (payload) => payloads.push(payload),
    })

    expect(provider.recordPageView({ route: '/' })).toBe(false)
    expect(provider.recordWebVital({ route: '/', name: 'LCP', value: 1, rating: 'good' })).toBe(false)
    await settle()
    expect(payloads).toEqual([])
  })

  it('bounds queued events and stops after synchronous or asynchronous transport failure', async () => {
    for (const firstCall of [
      () => { throw new Error('sync transport failure') },
      () => Promise.reject(new Error('async transport failure')),
    ]) {
      const calls = []
      const provider = createSimpleAnalyticsProvider({
        target: productionTarget(),
        maxQueue: 2,
        send(payload) {
          calls.push(payload.path)
          if (calls.length === 1) return firstCall()
        },
      })

      expect(provider.recordPageView({ route: '/' })).toBe(true)
      expect(provider.recordPageView({ route: '/about' })).toBe(true)
      expect(provider.recordPageView({ route: '/work/athena' })).toBe(false)
      await settle()

      expect(calls).toEqual(['/'])
      expect(provider.recordPageView({ route: '/about' })).toBe(false)
    }
  })
})
