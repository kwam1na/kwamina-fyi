import { canonicalRoute, UNRECOGNIZED_ROUTE } from './contract.js'

const WEB_VITAL_NAMES = new Set(['CLS', 'INP', 'LCP'])
const WEB_VITAL_RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const MAX_WEB_VITAL_VALUE = 86_400_000
const DEFAULT_MAX_QUEUE = 32

const SCRIPT_ATTRIBUTES = Object.freeze({
  'data-auto-collect': 'false',
  'data-ignore-metrics': 'referrer,utm,country,session,timeonpage,scrolled,useragent,screensize,viewportsize,language',
})

export const SIMPLE_ANALYTICS_SCRIPT_CONFIG = Object.freeze({
  src: 'https://scripts.simpleanalyticscdn.com/latest.js',
  async: true,
  referrerPolicy: 'no-referrer',
  attributes: SCRIPT_ATTRIBUTES,
})

export function loadSimpleAnalyticsScript(document = globalThis.document) {
  return new Promise((resolve, reject) => {
    const script = document?.createElement?.('script')
    if (!script || typeof document?.head?.append !== 'function') {
      reject(new Error('Simple Analytics script could not be appended'))
      return
    }

    script.src = SIMPLE_ANALYTICS_SCRIPT_CONFIG.src
    script.async = SIMPLE_ANALYTICS_SCRIPT_CONFIG.async
    script.referrerPolicy = SIMPLE_ANALYTICS_SCRIPT_CONFIG.referrerPolicy
    for (const [name, value] of Object.entries(SCRIPT_ATTRIBUTES)) script.setAttribute(name, value)
    script.onload = resolve
    script.onerror = () => reject(new Error('Simple Analytics script failed to load'))
    document.head.append(script)
  })
}

function safePageView(input) {
  const route = canonicalRoute(input?.route)
  return route === UNRECOGNIZED_ROUTE ? null : { type: 'pageview', route }
}

function safeWebVital(input) {
  const route = canonicalRoute(input?.route)
  if (route === UNRECOGNIZED_ROUTE) return null
  if (!WEB_VITAL_NAMES.has(input?.name) || !WEB_VITAL_RATINGS.has(input?.rating)) return null
  if (!Number.isFinite(input?.value) || input.value < 0) return null

  return {
    type: 'web_vital',
    route,
    name: input.name,
    value: Math.round(Math.min(input.value, MAX_WEB_VITAL_VALUE) * 1000) / 1000,
    rating: input.rating,
  }
}

function ready(target) {
  return Boolean(target?.sa_loaded)
    && typeof target?.sa_pageview === 'function'
    && typeof target?.sa_event === 'function'
}

export function createSimpleAnalyticsProvider({
  target = globalThis,
  document = target?.document,
  loadScript = loadSimpleAnalyticsScript,
  maxQueue = DEFAULT_MAX_QUEUE,
} = {}) {
  const queueLimit = Number.isInteger(maxQueue) && maxQueue >= 0 ? maxQueue : DEFAULT_MAX_QUEUE
  const queue = []
  let state = 'idle'
  let delivery = Promise.resolve()

  const fail = () => {
    state = 'failed'
    queue.length = 0
  }

  const send = (event) => {
    if (event.type === 'pageview') return target.sa_pageview(event.route)
    return target.sa_event('web_vital', {
      route: event.route,
      name: event.name,
      value: event.value,
      rating: event.rating,
    })
  }

  const deliver = (event) => {
    delivery = delivery.then(() => {
      if (state !== 'ready') return
      return send(event)
    }).catch(fail)
  }

  const startLoading = () => {
    state = 'loading'
    let loading
    try {
      loading = loadScript(document)
    } catch {
      fail()
      return
    }
    Promise.resolve(loading)
      .then(() => {
        if (!ready(target)) throw new Error('Simple Analytics globals unavailable')
        state = 'ready'
        while (queue.length > 0) deliver(queue.shift())
      })
      .catch(fail)
  }

  const accept = (event) => {
    if (!event || state === 'failed') return false
    if (state === 'ready') {
      deliver(event)
      return true
    }
    if (queue.length >= queueLimit) return false
    queue.push(event)
    if (state === 'idle') startLoading()
    return true
  }

  return Object.freeze({
    recordPageView(input) {
      return accept(safePageView(input))
    },
    recordWebVital(input) {
      return accept(safeWebVital(input))
    },
  })
}
