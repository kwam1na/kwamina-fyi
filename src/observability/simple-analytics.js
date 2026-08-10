import { canonicalRoute, sanitizeWebVitalMetric, UNRECOGNIZED_ROUTE } from './contract.js'

const DEFAULT_MAX_QUEUE = 32
const MOBILE_QUERY = '(max-width: 620px)'
const SIMPLE_ANALYTICS_HOSTNAME = 'kwamina.fyi'
const SIMPLE_ANALYTICS_USER_AGENT = 'Kwam-FYI/1.0 (+https://kwamina.fyi/)'

export const SIMPLE_ANALYTICS_ENDPOINT = 'https://queue.simpleanalyticscdn.com/events'

function doNotTrackEnabled(target) {
  return [target?.navigator?.doNotTrack, target?.doNotTrack, target?.navigator?.msDoNotTrack]
    .some((value) => Number.parseInt(value, 10) === 1)
}

function initialPageViewIsUnique(target) {
  const referrer = target?.document?.referrer
  if (!referrer) return true

  try {
    return new URL(referrer).hostname !== SIMPLE_ANALYTICS_HOSTNAME
  } catch {
    return false
  }
}

function isMobileLayout(target) {
  try {
    return target?.matchMedia?.(MOBILE_QUERY)?.matches === true
  } catch {
    return false
  }
}

function safePageView(input, unique, mobile) {
  const route = canonicalRoute(input?.route)
  if (route === UNRECOGNIZED_ROUTE) return null

  return {
    type: 'pageview',
    hostname: SIMPLE_ANALYTICS_HOSTNAME,
    event: 'pageview',
    path: route,
    unique,
    https: true,
    mobile,
    ua: SIMPLE_ANALYTICS_USER_AGENT,
  }
}

function safeWebVital(input, mobile) {
  const route = canonicalRoute(input?.route)
  if (route === UNRECOGNIZED_ROUTE) return null
  const metric = sanitizeWebVitalMetric(input)
  if (!metric) return null

  return {
    type: 'event',
    hostname: SIMPLE_ANALYTICS_HOSTNAME,
    event: 'web_vital',
    path: route,
    mobile,
    ua: SIMPLE_ANALYTICS_USER_AGENT,
    metadata: { route, ...metric },
  }
}

export function createSimpleAnalyticsTransport({ target = globalThis } = {}) {
  const fetcher = typeof target?.fetch === 'function' ? target.fetch.bind(target) : null

  return (payload) => {
    if (!fetcher) return Promise.reject(new Error('Simple Analytics transport unavailable'))

    let request
    try {
      request = fetcher(SIMPLE_ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        keepalive: true,
        referrerPolicy: 'no-referrer',
      })
    } catch (error) {
      return Promise.reject(error)
    }

    return Promise.resolve(request).then((response) => {
      if (!response?.ok) throw new Error('Simple Analytics rejected telemetry')
    })
  }
}

export function createSimpleAnalyticsProvider({
  target = globalThis,
  send = createSimpleAnalyticsTransport({ target }),
  maxQueue = DEFAULT_MAX_QUEUE,
} = {}) {
  const queueLimit = Number.isInteger(maxQueue) && maxQueue >= 0 ? maxQueue : DEFAULT_MAX_QUEUE
  const queue = []
  let state = doNotTrackEnabled(target) || typeof send !== 'function' ? 'failed' : 'ready'
  let draining = false
  let outstanding = 0
  let firstPageView = true
  const mobile = isMobileLayout(target)

  const fail = () => {
    state = 'failed'
    queue.length = 0
    outstanding = 0
    draining = false
  }

  const drain = () => {
    if (draining || state !== 'ready') return
    const payload = queue.shift()
    if (!payload) return

    draining = true
    Promise.resolve()
      .then(() => send(payload))
      .then(() => {
        draining = false
        outstanding -= 1
        drain()
      })
      .catch(fail)
  }

  const accept = (payload) => {
    if (!payload || state !== 'ready' || outstanding >= queueLimit) return false
    queue.push(payload)
    outstanding += 1
    drain()
    return true
  }

  return Object.freeze({
    recordPageView(input) {
      const payload = safePageView(input, firstPageView && initialPageViewIsUnique(target), mobile)
      const accepted = accept(payload)
      if (accepted) firstPageView = false
      return accepted
    },
    recordWebVital(input) {
      return accept(safeWebVital(input, mobile))
    },
  })
}
