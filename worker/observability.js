const ENVIRONMENTS = new Set(['local', 'preview', 'production', 'evaluation'])
const SOURCES = new Set(['site', 'evaluation'])
const RUN_KINDS = new Set(['human', 'synthetic'])
const ROUTES = new Map([
  ['/api/chat', 'api_chat'],
  ['/api/chat/transcript', 'api_transcript'],
])
const EVENTS = new Set([
  'assistant.issue',
  'assistant.operation',
  'assistant.refused',
  'assistant.replay',
  'worker.issue',
  'worker.operation',
])
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
  'ADMITTED',
  'ADMISSION_REJECTED',
  'BROWSER_RENDER_FAILED',
  'CONFIGURATION_MISSING',
  'CONTENT_STARTED',
  'EMPTY_COMPLETION',
  'MODEL_STARTED',
  'MODEL_FAILED',
  'PERSISTENCE_FAILED',
  'PERSISTENCE_STARTED',
  'PERSISTENCE_COMMITTED',
  'RATE_LIMITED',
  'RATE_LIMIT_BINDING_FAILED',
  'RATE_LIMIT_D1_FAILED',
  'RATE_LIMIT_SWEEP_COMPLETED',
  'RATE_LIMIT_SWEEP_FAILED',
  'REPLAY_EMPTY',
  'REPLAY_FAILED',
  'REPLAY_NONEMPTY',
  'REPLAY_STARTED',
  'REQUEST_TOO_LARGE',
  'RESERVATION_ACQUIRED',
  'RESERVATION_CONFLICT',
  'RESERVATION_SUPERSEDED',
  'SERVER_DURABLE_SUCCESS',
  'SOURCE_EXHAUSTED',
  'SOURCE_FAILED',
  'STREAM_CANCELLED',
  'STREAM_COMPLETED',
  'STREAM_INTERRUPTED',
  'TERMINAL_EMITTED',
  'UNHANDLED_FAILURE',
])
const STATUS_CLASSES = new Set(['2xx', '4xx', '5xx'])
const OPERATION_ID_PATTERN = /^op_[a-f0-9]{32}$/
const RELEASE_PATTERN = /^kwamina-fyi-worker@[a-f0-9]{12,64}$/
const EXPECTED_WINDOW_MS = 60_000

function fromSet(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined
}

function fromPattern(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined
}

function workerRoute(value) {
  if (typeof value !== 'string' || value.length > 2048) return 'unrecognized'
  try {
    return ROUTES.get(new URL(value, 'https://telemetry.invalid').pathname) ?? 'unrecognized'
  } catch {
    return 'unrecognized'
  }
}

export function sanitizeWorkerEvent(input = {}) {
  const durationMs = Number.isFinite(input.durationMs) && input.durationMs >= 0
    ? Math.min(Math.round(input.durationMs), 86_400_000)
    : undefined
  const occurrences = Number.isInteger(input.occurrences) && input.occurrences > 0
    ? Math.min(input.occurrences, 1000)
    : undefined
  const event = {
    event: fromSet(input.event, EVENTS),
    route: workerRoute(input.route),
    environment: fromSet(input.environment, ENVIRONMENTS),
    source: fromSet(input.source, SOURCES),
    runKind: fromSet(input.runKind, RUN_KINDS),
    release: fromPattern(input.release, RELEASE_PATTERN),
    assistantVersion: fromPattern(input.assistantVersion, /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/),
    corpusVersion: fromPattern(input.corpusVersion, /^[a-f0-9]{12}$/),
    modelVersion: fromPattern(input.modelVersion, /^[A-Za-z0-9._-]{1,64}$/),
    stage: fromSet(input.stage, STAGES),
    outcomeCode: fromSet(input.outcomeCode, OUTCOME_CODES),
    statusClass: fromSet(input.statusClass, STATUS_CLASSES),
    durationMs,
    operationId: fromPattern(input.operationId, OPERATION_ID_PATTERN),
    occurrences,
  }
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined))
}

export function createOperationId({ randomUUID = () => crypto.randomUUID() } = {}) {
  const uuid = randomUUID()
  const hex = typeof uuid === 'string' ? uuid.replaceAll('-', '').toLowerCase() : ''
  if (!/^[a-f0-9]{32}$/.test(hex)) throw new TypeError('Operation ID generation failed.')
  return `op_${hex}`
}

export function createWorkerObservability({
  log = () => {},
  captureIssue = () => {},
  now = () => Date.now(),
} = {}) {
  const expectedWindows = new Map()

  function send(transport, input) {
    const event = sanitizeWorkerEvent(input)
    if (!event.event || !event.outcomeCode) return
    try {
      transport(event)
    } catch {
      // Never recurse or let observability alter the Worker response.
    }
  }

  return Object.freeze({
    record(input) {
      send(log, input)
    },
    captureActionableIssue(input) {
      send(captureIssue, input)
    },
    recordExpectedRefusal(input) {
      const event = sanitizeWorkerEvent({ ...input, occurrences: 1 })
      if (!event.event || !event.outcomeCode) return
      const window = Math.floor(now() / EXPECTED_WINDOW_MS)
      if (expectedWindows.get(event.outcomeCode) === window) return
      expectedWindows.set(event.outcomeCode, window)
      try {
        log(event)
      } catch {
        // Expected-refusal telemetry is best-effort and never self-reports.
      }
    },
  })
}
