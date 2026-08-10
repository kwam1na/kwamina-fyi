import { LEGACY_REDIRECTS, NAVIGABLE_PATHS, normalisePath } from '../routes.js'

export const UNRECOGNIZED_ROUTE = 'unrecognized'

const ENVIRONMENTS = new Set(['local', 'preview', 'production', 'evaluation'])
const RENDER_CONTEXTS = new Set(['root_render', 'live_render', 'replay_render'])
const STAGES = new Set([
  'admission',
  'reservation',
  'model_start',
  'first_content',
  'stream',
  'persistence',
  'terminal',
  'replay',
  'render',
])
const OUTCOME_CODES = new Set([
  'ADMISSION_REJECTED',
  'BROWSER_RENDER_FAILED',
  'EMPTY_COMPLETION',
  'MODEL_FAILED',
  'PERSISTENCE_FAILED',
  'RATE_LIMITED',
  'REPLAY_FAILED',
  'RESERVATION_SUPERSEDED',
  'STREAM_INTERRUPTED',
  'UNHANDLED_FAILURE',
])
const OPERATION_ID_PATTERN = /^op_[a-f0-9]{32}$/
const FINGERPRINT_PATTERN = /^stack-[a-f0-9]{8}$/
const RELEASE_PATTERN = /^kwamina-fyi(?:-worker)?@[a-f0-9]{12,64}$/
const WEB_VITAL_NAMES = new Set(['CLS', 'INP', 'LCP'])
const WEB_VITAL_RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const MAX_WEB_VITAL_VALUE = 86_400_000

export function pathnameFrom(value) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    return new URL(value, 'https://telemetry.invalid').pathname
  } catch {
    return null
  }
}

export function canonicalRoute(value) {
  const pathname = pathnameFrom(value)
  if (!pathname) return UNRECOGNIZED_ROUTE
  const normalized = normalisePath(pathname)
  const canonical = LEGACY_REDIRECTS[normalized] ?? normalized
  return NAVIGABLE_PATHS.has(canonical) ? canonical : UNRECOGNIZED_ROUTE
}

export function sanitizeWebVitalMetric(metric) {
  if (!WEB_VITAL_NAMES.has(metric?.name)) return null
  if (!WEB_VITAL_RATINGS.has(metric?.rating)) return null
  if (!Number.isFinite(metric?.value) || metric.value < 0) return null
  return {
    name: metric.name,
    value: Math.round(Math.min(metric.value, MAX_WEB_VITAL_VALUE) * 1000) / 1000,
    rating: metric.rating,
  }
}

function keepString(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined
}

function keepPattern(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined
}

function boundedInteger(value, maximum = 86_400_000) {
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.min(Math.round(value), maximum)
}

export function sanitizeBrowserEvent(input = {}) {
  const event = {
    route: canonicalRoute(input.route),
    environment: keepString(input.environment, ENVIRONMENTS),
    release: keepPattern(input.release, RELEASE_PATTERN),
    renderContext: keepString(input.renderContext, RENDER_CONTEXTS),
    stage: keepString(input.stage, STAGES),
    outcomeCode: keepString(input.outcomeCode, OUTCOME_CODES),
    fingerprint: keepPattern(input.fingerprint, FINGERPRINT_PATTERN),
    operationId: keepPattern(input.operationId, OPERATION_ID_PATTERN),
  }

  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined))
}

function safeFrameLocation(frame = {}) {
  const pathname = pathnameFrom(frame.filename)
  const filename = pathname?.split('/').filter(Boolean).at(-1)
  const lineno = boundedInteger(frame.lineno, 10_000_000)
  const colno = boundedInteger(frame.colno, 10_000)
  if (!filename || !/^[A-Za-z0-9._-]{1,120}$/.test(filename) || lineno === undefined || colno === undefined) {
    return null
  }
  return `${filename}:${lineno}:${colno}`
}

function fnv1a(value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function stableStackFingerprint(frames) {
  const signature = Array.isArray(frames)
    ? frames.map(safeFrameLocation).filter(Boolean).slice(-8).join('|')
    : ''
  return `stack-${fnv1a(signature || 'unmapped')}`
}

export function sanitizeSentryIssue(event = {}) {
  const frames = event.exception?.values?.flatMap((value) => value.stacktrace?.frames ?? []) ?? []
  const safe = sanitizeBrowserEvent({
    ...event.tags,
    release: event.release,
    environment: event.environment,
    fingerprint: event.fingerprint?.[0] ?? stableStackFingerprint(frames),
  })
  if (!safe.outcomeCode || !safe.release || !safe.environment) return null

  return {
    event_id: keepPattern(event.event_id, /^[a-f0-9]{32}$/),
    platform: 'javascript',
    level: 'error',
    release: safe.release,
    environment: safe.environment,
    tags: safe,
    fingerprint: [safe.fingerprint ?? stableStackFingerprint(frames)],
    exception: {
      values: [{ type: safe.outcomeCode, value: safe.outcomeCode }],
    },
  }
}
