import { canonicalRoute, sanitizeWebVitalMetric, UNRECOGNIZED_ROUTE } from './contract.js'

const DEFAULT_MAX_QUEUE = 32

const SCRIPT_ATTRIBUTES = Object.freeze({
  'data-auto-collect': 'false',
  'data-ignore-metrics': 'referrer,utm,country,session,timeonpage,scrolled,useragent,screensize,viewportsize,language',
})

export const SIMPLE_ANALYTICS_SCRIPT_CONFIG = Object.freeze({
  src: 'https://scripts.simpleanalyticscdn.com/sri/v11.js',
  async: true,
  referrerPolicy: 'no-referrer',
  integrity: 'sha256-hkUzQr3zWmSDnmhw95ZmQSZ949upqD+ML9ejiN0UIIE= sha384-rfv15RJy1bBYZ1Mf4xizO26jorXb2myipCvHXy4rkG0SuEET96S+m0sTzu5vfbSI sha512-lQzjzTbOxHLwkZGDVMf4V0sm8v2Mrqm73IvKcXBftJ/MSZKQC4/jwKFToxT+3IVAVWQzLplSNHH8gM5d7b1BSg==',
  crossOrigin: 'anonymous',
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
    script.integrity = SIMPLE_ANALYTICS_SCRIPT_CONFIG.integrity
    script.crossOrigin = SIMPLE_ANALYTICS_SCRIPT_CONFIG.crossOrigin
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
  const metric = sanitizeWebVitalMetric(input)
  if (!metric) return null

  return {
    type: 'web_vital',
    route,
    ...metric,
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
  let draining = false

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

  const drain = () => {
    if (draining || state !== 'ready') return
    const event = queue.shift()
    if (!event) return

    draining = true
    Promise.resolve()
      .then(() => send(event))
      .then(() => {
        draining = false
        drain()
      })
      .catch(fail)
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
        drain()
      })
      .catch(fail)
  }

  const accept = (event) => {
    if (!event || state === 'failed') return false
    if (queue.length >= queueLimit) return false
    queue.push(event)
    if (state === 'idle') startLoading()
    else if (state === 'ready') drain()
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
