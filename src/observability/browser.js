import {
  captureException,
  dedupeIntegration,
  inboundFiltersIntegration,
  init,
} from '@sentry/react'
import {
  sanitizeBrowserEvent,
  sanitizeSentryIssue,
  stableStackFingerprint,
} from './contract.js'

const disabledBrowserObservability = Object.freeze({
  enabled: false,
  captureActionableIssue() {},
})

const defaultSentrySdk = Object.freeze({
  captureException,
  dedupeIntegration,
  inboundFiltersIntegration,
  init,
})

let activeBrowserFailureReporter = createBrowserFailureReporter(disabledBrowserObservability)

function ready(config) {
  return config?.environment === 'production'
    && config.providerReady === true
    && typeof config.dsn === 'string'
    && config.dsn.length > 0
    && /^kwamina-fyi@[a-f0-9]{12,64}$/.test(config.release ?? '')
}

function pathnameFrom(value) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    return new URL(value, 'https://telemetry.invalid').pathname
  } catch {
    return null
  }
}

function safeAssetPath(value) {
  const pathname = pathnameFrom(value)
  if (!pathname || pathname.length > 180 || pathname.includes('..')) return null
  return /^\/assets\/[a-z][a-z0-9-]{0,48}-[A-Za-z0-9_-]{8,32}\.js$/.test(pathname)
    ? pathname
    : null
}

function safeFrame(frame = {}, assetByBasename = new Map()) {
  const pathname = pathnameFrom(frame.abs_path ?? frame.filename)
  const filename = pathname?.split('/').filter(Boolean).at(-1)
  const lineno = Number(frame.lineno)
  const colno = Number(frame.colno)
  if (!filename || !/^[A-Za-z0-9._-]{1,120}$/.test(filename)) return null
  if (!Number.isInteger(lineno) || lineno < 0 || lineno > 10_000_000) return null
  if (!Number.isInteger(colno) || colno < 0 || colno > 10_000) return null
  const assetPath = assetByBasename.get(filename)
  return assetPath
    ? { filename: assetPath, abs_path: assetPath, lineno, colno }
    : { filename, lineno, colno }
}

function safeDebugImages(event = {}) {
  return (event.debug_meta?.images ?? [])
    .map((image) => {
      const codeFile = safeAssetPath(image?.code_file)
      const debugId = typeof image?.debug_id === 'string'
        && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(image.debug_id)
        ? image.debug_id
        : null
      if (image?.type !== 'sourcemap' || !codeFile || !debugId) return null
      return { type: 'sourcemap', code_file: codeFile, debug_id: debugId }
    })
    .filter(Boolean)
    .slice(0, 16)
}

export function safeErrorFrames(value) {
  if (typeof value?.stack !== 'string') return []
  return value.stack
    .split('\n')
    .slice(1)
    .map((line) => {
      const match = line.match(/(?:\(|\s)(.+?):(\d+):(\d+)\)?$/)
      if (!match) return null
      return safeFrame({ filename: match[1], lineno: Number(match[2]), colno: Number(match[3]) })
    })
    .filter(Boolean)
    .slice(-8)
}

function safeException(outcomeCode, frames) {
  const exception = new Error(outcomeCode)
  exception.name = outcomeCode
  exception.cause = undefined
  exception.stack = [outcomeCode, ...frames.map((frame) => (
    `    at ${frame.filename}:${frame.lineno}:${frame.colno}`
  ))].join('\n')
  return exception
}

export function scrubBrowserIssue(event) {
  const issue = sanitizeSentryIssue(event)
  if (!issue) return null
  const images = safeDebugImages(event)
  const assetByBasename = new Map(images.map((image) => [image.code_file.split('/').at(-1), image.code_file]))
  const frames = (event.exception?.values ?? [])
    .flatMap((value) => value.stacktrace?.frames ?? [])
    .map((frame) => safeFrame(frame, assetByBasename))
    .filter(Boolean)
    .slice(-8)
  if (frames.length > 0) issue.exception.values[0].stacktrace = { frames }
  const referencedAssets = new Set(frames.map((frame) => frame.abs_path).filter(Boolean))
  const matchingImages = images.filter((image) => referencedAssets.has(image.code_file))
  if (matchingImages.length > 0) issue.debug_meta = { images: matchingImages }
  return issue
}

export function isExpectedBrowserFailure(value) {
  if (value?.name === 'AbortError' || value?.name === 'ChatExpectedFailure') return true
  const status = Number(value?.status)
  return Number.isInteger(status) && status >= 400 && status < 500
}

function errorEventValue(event) {
  if (event?.error !== undefined && event.error !== null) return event.error
  const frame = safeFrame({
    filename: event?.filename,
    lineno: event?.lineno,
    colno: event?.colno,
  })
  if (!frame) return null
  return { stack: `UNHANDLED_FAILURE\n    at ${frame.filename}:${frame.lineno}:${frame.colno}` }
}

export function createBrowserFailureReporter(client, baseContext = {}, scheduling = {}) {
  const schedule = scheduling.schedule ?? ((callback) => setTimeout(callback, 50))
  const cancel = scheduling.cancel ?? clearTimeout
  const captured = new WeakSet()
  const pending = new WeakMap()

  const context = () => (
    typeof baseContext === 'function' ? baseContext() : baseContext
  )

  const hasObjectIdentity = (value) => (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  )

  const capture = (value, details) => {
    if (isExpectedBrowserFailure(value)) return
    if (hasObjectIdentity(value)) {
      const token = pending.get(value)
      if (token !== undefined) {
        cancel(token)
        pending.delete(value)
      }
      if (captured.has(value)) return
      captured.add(value)
    }
    client.captureActionableIssue(value, { ...context(), ...details })
  }

  return Object.freeze({
    captureRenderFailure(value, renderContext, details = {}) {
      capture(value, {
        stage: 'render',
        outcomeCode: 'BROWSER_RENDER_FAILED',
        ...details,
        renderContext,
      })
    },
    observeGlobalFailure(value, details = {}) {
      if (isExpectedBrowserFailure(value)) return
      if (!hasObjectIdentity(value)) {
        schedule(() => capture(value, {
          stage: 'render',
          outcomeCode: 'UNHANDLED_FAILURE',
          ...details,
        }))
        return
      }
      if (captured.has(value) || pending.has(value)) return
      const token = schedule(() => {
        pending.delete(value)
        capture(value, {
          stage: 'render',
          outcomeCode: 'UNHANDLED_FAILURE',
          ...details,
        })
      })
      pending.set(value, token)
    },
  })
}

export function installBrowserFailureHandlers(target, reporter) {
  if (!target?.addEventListener) return () => {}
  const onError = (event) => reporter.observeGlobalFailure(errorEventValue(event))
  const onUnhandledRejection = (event) => reporter.observeGlobalFailure(event?.reason)
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}

export function startBrowserObservability(config, sdk = defaultSentrySdk, target = globalThis.window) {
  const client = initializeBrowserObservability(config, sdk)
  activeBrowserFailureReporter = createBrowserFailureReporter(client, () => ({
    route: target?.location?.href,
    environment: config?.environment,
    release: config?.release,
  }))
  installBrowserFailureHandlers(target, activeBrowserFailureReporter)
  return client
}

export function captureBrowserRenderFailure(error, renderContext, details) {
  activeBrowserFailureReporter.captureRenderFailure(error, renderContext, details)
}

export function initializeBrowserObservability(config, sdk = defaultSentrySdk) {
  if (!ready(config)) return disabledBrowserObservability

  try {
    sdk.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      defaultIntegrations: false,
      integrations: [sdk.inboundFiltersIntegration(), sdk.dedupeIntegration()],
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: false, outputs: false },
        stackFrameVariables: false,
        frameContextLines: 0,
      },
      enableLogs: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      beforeBreadcrumb: () => null,
      beforeSend: scrubBrowserIssue,
    })
  } catch {
    return disabledBrowserObservability
  }

  return Object.freeze({
    enabled: true,
    captureActionableIssue(error, details) {
      if (details === undefined) {
        details = error
        error = null
      }
      const frames = safeErrorFrames(error)
      const event = sanitizeBrowserEvent(details)
      if (!event.outcomeCode) return
      const fingerprint = event.fingerprint ?? stableStackFingerprint(frames)
      try {
        sdk.captureException(safeException(event.outcomeCode, frames), {
          fingerprint: [fingerprint],
          tags: { ...event, fingerprint },
        })
      } catch {
        // Telemetry must never alter the browser recovery path or report itself.
      }
    },
  })
}
