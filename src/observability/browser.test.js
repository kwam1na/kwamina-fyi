import { describe, expect, it } from 'bun:test'
import {
  createBrowserFailureReporter,
  initializeBrowserObservability,
  installBrowserFailureHandlers,
  scrubBrowserIssue,
  startBrowserObservability,
  isExpectedBrowserFailure,
} from './browser.js'

const SENTINEL = 'private-browser-error-8f2c'

function configuredClient(captures) {
  return initializeBrowserObservability({
    environment: 'production',
    providerReady: true,
    dsn: 'https://public@example.ingest.sentry.io/1',
    release: 'kwamina-fyi@0123456789abcdef',
  }, {
    init() {},
    inboundFiltersIntegration: () => ({ name: 'InboundFilters' }),
    dedupeIntegration: () => ({ name: 'Dedupe' }),
    captureException: (...args) => captures.push(args),
  })
}

describe('browser failure capture', () => {
  it('replaces arbitrary error text while retaining safe frame locations', () => {
    const captures = []
    const client = configuredClient(captures)
    const error = new Error(SENTINEL, { cause: new Error(`cause-${SENTINEL}`) })
    error.stack = `${SENTINEL}\n    at render (https://kwamina.fyi/assets/app.js?token=${SENTINEL}:14:8)`

    client.captureActionableIssue(error, {
      route: `/about?secret=${SENTINEL}`,
      environment: 'production',
      release: 'kwamina-fyi@0123456789abcdef',
      renderContext: 'root_render',
      stage: 'render',
      outcomeCode: 'BROWSER_RENDER_FAILED',
    })

    expect(captures).toHaveLength(1)
    expect(captures[0][0].message).toBe('BROWSER_RENDER_FAILED')
    expect(captures[0][0].stack).toContain('app.js:14:8')
    expect(JSON.stringify(captures)).not.toContain(SENTINEL)
  })

  it('prefers boundary context when the same failure is also observed globally', () => {
    const captures = []
    const listeners = new Map()
    const scheduled = []
    const target = {
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name) => listeners.delete(name),
    }
    const reporter = createBrowserFailureReporter(configuredClient(captures), {
      route: '/work/athena',
      environment: 'production',
      release: 'kwamina-fyi@0123456789abcdef',
    }, {
      schedule: (callback) => {
        scheduled.push(callback)
        return callback
      },
      cancel: (callback) => {
        const index = scheduled.indexOf(callback)
        if (index >= 0) scheduled.splice(index, 1)
      },
    })
    installBrowserFailureHandlers(target, reporter)
    const error = new Error(SENTINEL)
    error.stack = `${SENTINEL}\n    at https://kwamina.fyi/assets/app.js:20:4`

    listeners.get('error')({ error })
    reporter.captureRenderFailure(error, 'root_render')
    scheduled.splice(0).forEach((callback) => callback())

    expect(captures).toHaveLength(1)
    expect(captures[0][1].tags).toMatchObject({
      route: '/work/athena',
      renderContext: 'root_render',
      outcomeCode: 'BROWSER_RENDER_FAILED',
    })
  })

  it('starts the allowlisted client and global handlers as one pre-mount step', () => {
    const initialized = []
    const listeners = new Map()
    const target = {
      location: { href: `https://kwamina.fyi/about?secret=${SENTINEL}` },
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name) => listeners.delete(name),
    }
    const client = startBrowserObservability({
      environment: 'production',
      providerReady: true,
      dsn: 'https://public@example.ingest.sentry.io/1',
      release: 'kwamina-fyi@0123456789abcdef',
    }, {
      init: (options) => initialized.push(options),
      inboundFiltersIntegration: () => ({ name: 'InboundFilters' }),
      dedupeIntegration: () => ({ name: 'Dedupe' }),
      captureException() {},
    }, target)

    expect(client.enabled).toBe(true)
    expect(initialized).toHaveLength(1)
    expect([...listeners.keys()]).toEqual(['error', 'unhandledrejection'])
  })

  it('starts browser observability before React mounts', async () => {
    const source = await Bun.file(new URL('../main.jsx', import.meta.url)).text()
    expect(source.indexOf('startBrowserObservability({')).toBeGreaterThan(-1)
    expect(source.indexOf('startBrowserObservability({')).toBeLessThan(source.indexOf('createRoot('))
  })

  it('retains only matching sanitized debug metadata needed for source mapping', () => {
    const issue = scrubBrowserIssue({
      release: 'kwamina-fyi@0123456789abcdef',
      environment: 'production',
      tags: {
        route: '/about',
        renderContext: 'root_render',
        stage: 'render',
        outcomeCode: 'BROWSER_RENDER_FAILED',
      },
      exception: { values: [{ value: SENTINEL, stacktrace: { frames: [{
        filename: `https://kwamina.fyi/assets/index-CC8mIe1W.js?secret=${SENTINEL}`,
        abs_path: `https://kwamina.fyi/assets/index-CC8mIe1W.js?secret=${SENTINEL}`,
        lineno: 14,
        colno: 8,
      }] } }] },
      debug_meta: { images: [
        {
          type: 'sourcemap',
          code_file: `https://kwamina.fyi/assets/index-CC8mIe1W.js?secret=${SENTINEL}`,
          debug_id: '01234567-89ab-cdef-0123-456789abcdef',
        },
        { type: SENTINEL, code_file: `/${SENTINEL}.js`, debug_id: SENTINEL },
      ] },
    })

    expect(issue.debug_meta).toEqual({ images: [{
      type: 'sourcemap',
      code_file: '/assets/index-CC8mIe1W.js',
      debug_id: '01234567-89ab-cdef-0123-456789abcdef',
    }] })
    expect(issue.exception.values[0].stacktrace.frames[0]).toEqual({
      filename: '/assets/index-CC8mIe1W.js',
      abs_path: '/assets/index-CC8mIe1W.js',
      lineno: 14,
      colno: 8,
    })
    expect(JSON.stringify(issue)).not.toContain(SENTINEL)
  })

  it('captures uncaught errors and non-Error rejections once without their values', () => {
    const captures = []
    const listeners = new Map()
    const scheduled = []
    const target = {
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener() {},
    }
    const reporter = createBrowserFailureReporter(configuredClient(captures), {
      route: '/about',
      environment: 'production',
      release: 'kwamina-fyi@0123456789abcdef',
    }, {
      schedule: (callback) => scheduled.push(callback) - 1,
      cancel() {},
    })
    installBrowserFailureHandlers(target, reporter)
    const error = new Error(SENTINEL)
    error.stack = `${SENTINEL}\n    at https://kwamina.fyi/assets/index-CC8mIe1W.js:31:6`

    listeners.get('error')({ error })
    listeners.get('unhandledrejection')({ reason: `thrown-${SENTINEL}` })
    scheduled.splice(0).forEach((callback) => callback())

    expect(captures).toHaveLength(2)
    expect(captures.map((capture) => capture[1].tags.outcomeCode)).toEqual([
      'UNHANDLED_FAILURE',
      'UNHANDLED_FAILURE',
    ])
    expect(JSON.stringify(captures)).not.toContain(SENTINEL)
  })

  it('excludes user cancellation and expected chat API refusals', () => {
    const cancellation = new Error('cancelled by visitor')
    cancellation.name = 'AbortError'
    const refusal = new Error('rate limited')
    refusal.name = 'ChatExpectedFailure'

    expect(isExpectedBrowserFailure(cancellation)).toBe(true)
    expect(isExpectedBrowserFailure(refusal)).toBe(true)
    expect(isExpectedBrowserFailure({ status: 429 })).toBe(true)
  })
})
