import { describe, expect, it } from 'bun:test'
import {
  canonicalRoute,
  sanitizeBrowserEvent,
  sanitizeSentryIssue,
  stableStackFingerprint,
} from './contract.js'
import { initializeBrowserObservability } from './browser.js'

const SENTINEL = 'private-chat-text-7c3f'

describe('browser observability contract', () => {
  it('keeps only approved bounded fields and canonicalizes routes', () => {
    expect(sanitizeBrowserEvent({
      route: `https://kwamina.fyi/work/athena/?secret=${SENTINEL}#${SENTINEL}`,
      environment: 'production',
      release: 'kwamina-fyi@0123456789abcdef',
      renderContext: 'replay_render',
      stage: 'render',
      outcomeCode: 'BROWSER_RENDER_FAILED',
      fingerprint: 'stack-a1b2c3d4',
      operationId: 'op_0123456789abcdef0123456789abcdef',
      message: SENTINEL,
      threadId: `thread-${SENTINEL}`,
      callerHash: SENTINEL,
      headers: { authorization: `Bearer ${SENTINEL}` },
      body: SENTINEL,
      referrer: `https://elsewhere.example/${SENTINEL}`,
      ip: '203.0.113.7',
      userAgent: SENTINEL,
      dom: `<input value="${SENTINEL}">`,
      credentials: SENTINEL,
    })).toEqual({
      route: '/work/athena',
      environment: 'production',
      release: 'kwamina-fyi@0123456789abcdef',
      renderContext: 'replay_render',
      stage: 'render',
      outcomeCode: 'BROWSER_RENDER_FAILED',
      fingerprint: 'stack-a1b2c3d4',
      operationId: 'op_0123456789abcdef0123456789abcdef',
    })
  })

  it('maps legacy and unknown paths to bounded canonical values', () => {
    expect(canonicalRoute('/homepage.html')).toBe('/')
    expect(canonicalRoute('/work/local-first-pos?ignored=yes')).toBe('/work/athena/local-first-pos')
    expect(canonicalRoute(`/not-real/${SENTINEL}?q=${SENTINEL}`)).toBe('unrecognized')
  })

  it('groups repeated safe stack signatures without retaining stack text', () => {
    const first = stableStackFingerprint([
      { filename: 'https://kwamina.fyi/assets/app.js?token=secret', lineno: 14, colno: 8 },
      { filename: '/src/chat/chat-panel.jsx', lineno: 171, colno: 5 },
    ])
    const repeat = stableStackFingerprint([
      { filename: 'https://preview.example/assets/app.js#private', lineno: 14, colno: 8 },
      { filename: '/src/chat/chat-panel.jsx', lineno: 171, colno: 5 },
    ])
    const different = stableStackFingerprint([
      { filename: '/assets/app.js', lineno: 14, colno: 9 },
      { filename: '/src/chat/chat-panel.jsx', lineno: 171, colno: 5 },
    ])

    expect(first).toMatch(/^stack-[a-f0-9]{8}$/)
    expect(repeat).toBe(first)
    expect(different).not.toBe(first)
    expect(first).not.toContain(SENTINEL)
  })

  it('rebuilds provider issues from the allowlist instead of mutating untrusted events', () => {
    const issue = sanitizeSentryIssue({
      event_id: '0123456789abcdef0123456789abcdef',
      release: 'kwamina-fyi@0123456789abcdef',
      environment: 'production',
      message: SENTINEL,
      request: { url: `https://kwamina.fyi/about?q=${SENTINEL}`, headers: { cookie: SENTINEL } },
      user: { id: SENTINEL, ip_address: '203.0.113.7' },
      contexts: { trace: { data: SENTINEL } },
      extra: { body: SENTINEL },
      breadcrumbs: [{ message: SENTINEL }],
      tags: {
        route: '/about',
        renderContext: 'root_render',
        stage: 'render',
        outcomeCode: 'BROWSER_RENDER_FAILED',
      },
      exception: { values: [{ value: SENTINEL, stacktrace: { frames: [
        { filename: `https://kwamina.fyi/assets/app.js?q=${SENTINEL}`, lineno: 7, colno: 3 },
      ] } }] },
    })

    expect(issue.exception.values[0]).toEqual({
      type: 'BROWSER_RENDER_FAILED',
      value: 'BROWSER_RENDER_FAILED',
    })
    expect(JSON.stringify(issue)).not.toContain(SENTINEL)
    expect(issue).not.toHaveProperty('request')
    expect(issue).not.toHaveProperty('user')
    expect(issue).not.toHaveProperty('contexts')
    expect(issue).not.toHaveProperty('extra')
    expect(issue).not.toHaveProperty('breadcrumbs')
  })

  it('initializes only after production provider readiness and fails open', () => {
    const initialized = []
    const captures = []
    const sdk = {
      init: (options) => initialized.push(options),
      inboundFiltersIntegration: () => ({ name: 'InboundFilters' }),
      dedupeIntegration: () => ({ name: 'Dedupe' }),
      captureException: (...args) => captures.push(args),
    }

    const disabled = initializeBrowserObservability({
      environment: 'preview',
      providerReady: true,
      dsn: 'https://public@example.ingest.sentry.io/1',
      release: 'kwamina-fyi@0123456789abcdef',
    }, sdk)
    expect(disabled.enabled).toBe(false)
    expect(initialized).toHaveLength(0)

    const enabled = initializeBrowserObservability({
      environment: 'production',
      providerReady: true,
      dsn: 'https://public@example.ingest.sentry.io/1',
      release: 'kwamina-fyi@0123456789abcdef',
    }, sdk)
    expect(enabled.enabled).toBe(true)
    expect(initialized[0]).toMatchObject({
      defaultIntegrations: false,
      enableLogs: false,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      tracesSampleRate: 0,
    })

    sdk.captureException = () => { throw new Error(SENTINEL) }
    expect(() => enabled.captureActionableIssue({
      route: '/about',
      environment: 'production',
      release: 'kwamina-fyi@0123456789abcdef',
      renderContext: 'root_render',
      stage: 'render',
      outcomeCode: 'BROWSER_RENDER_FAILED',
      fingerprint: 'stack-a1b2c3d4',
    })).not.toThrow()
  })
})
