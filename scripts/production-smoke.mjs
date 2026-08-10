import { randomUUID as nodeRandomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROUTE_PATHS } from '../src/routes.js'

export const PRODUCTION_ORIGIN = 'https://kwamina.fyi'

const PAGE_CHECKS = [
  { path: ROUTE_PATHS.home, marker: '<title>Kwamina Essuah Mensah</title>', label: 'Homepage' },
  {
    path: ROUTE_PATHS.agentReadyRepository,
    marker: '<div id="root"></div>',
    label: 'Nested page',
  },
]

const SYNTHETIC_PROMPT = 'In one sentence, what can a visitor learn from this site?'
const OPERATION_ID_PATTERN = /^op_[a-f0-9]{32}$/
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_STREAM_BYTES = 262_144

export class SmokeFailure extends Error {
  constructor(message) {
    super(message)
    this.name = 'SmokeFailure'
  }
}

function isRedirect(response) {
  return REDIRECT_STATUSES.has(response.status)
}

async function safeFetch(fetcher, url, init, failureMessage) {
  try {
    return await fetcher(url, { ...init, redirect: 'manual' })
  } catch {
    throw new SmokeFailure(failureMessage)
  }
}

async function checkPage(fetcher, { path, marker, label }) {
  const response = await safeFetch(
    fetcher,
    `${PRODUCTION_ORIGIN}${path}`,
    { method: 'GET', headers: { accept: 'text/html' } },
    `${label} contract check failed.`,
  )
  if (
    isRedirect(response)
    || !response.ok
    || !response.headers.get('content-type')?.toLowerCase().startsWith('text/html')
  ) {
    throw new SmokeFailure(`${label} contract check failed.`)
  }

  let body
  try {
    body = await response.text()
  } catch {
    throw new SmokeFailure(`${label} contract check failed.`)
  }
  if (!body.includes(marker)) throw new SmokeFailure(`${label} contract check failed.`)
}

async function checkApi(fetcher, { path, method, headers = {}, status, label }) {
  const response = await safeFetch(
    fetcher,
    `${PRODUCTION_ORIGIN}${path}`,
    { method, headers: { accept: 'application/json', ...headers } },
    `${label} contract check failed.`,
  )
  if (
    isRedirect(response)
    || response.status !== status
    || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  ) {
    throw new SmokeFailure(`${label} contract check failed.`)
  }
}

export async function runContractChecks({ fetcher = fetch } = {}) {
  for (const page of PAGE_CHECKS) await checkPage(fetcher, page)
  await checkApi(fetcher, {
    path: '/api/observability-canary',
    method: 'GET',
    status: 404,
    label: 'Unknown API',
  })
  await checkApi(fetcher, {
    path: '/api/chat/transcript',
    method: 'GET',
    status: 400,
    label: 'Malformed transcript',
  })
}

async function hasTerminalEvent(response) {
  if (!response.body) return false
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let terminalObserved = false
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      totalBytes += value?.byteLength ?? 0
      if (totalBytes > MAX_STREAM_BYTES) {
        throw new SmokeFailure('Assistant stream contract invalid.')
      }
      pending += decoder.decode(value, { stream: !done })
      if (pending.length > MAX_STREAM_BYTES) throw new SmokeFailure('Assistant stream contract invalid.')
      const lines = pending.split('\n')
      pending = done ? '' : lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const event = JSON.parse(line.slice(5).trim())
          if (event?.type === 'RUN_FINISHED') terminalObserved = true
        } catch {
          throw new SmokeFailure('Assistant stream contract invalid.')
        }
      }

      if (done) return terminalObserved
    }
  } catch (error) {
    if (error instanceof SmokeFailure) throw error
    throw new SmokeFailure('Assistant stream contract failed.')
  }
}

function chatBody(threadId, randomUUID) {
  return JSON.stringify({
    threadId,
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: 'user', content: SYNTHETIC_PROMPT }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: { pagePath: '/' },
  })
}

export async function runAssistantCanary({
  token,
  fetcher = fetch,
  randomUUID = nodeRandomUUID,
  log = () => {},
} = {}) {
  if (!token) throw new SmokeFailure('CHAT_EVALUATION_TOKEN is required.')

  const threadId = randomUUID()
  let response = await safeFetch(fetcher, `${PRODUCTION_ORIGIN}/api/chat`, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-chat-evaluation-token': token,
    },
    body: chatBody(threadId, randomUUID),
  }, 'Assistant request failed.')

  if (isRedirect(response)) throw new SmokeFailure('Assistant request redirected.')
  if (response.headers.get('x-run-kind') !== 'synthetic') {
    throw new SmokeFailure('Assistant synthetic acknowledgement missing.')
  }
  if (!OPERATION_ID_PATTERN.test(response.headers.get('x-operation-id') ?? '')) {
    throw new SmokeFailure('Assistant operation acknowledgement missing.')
  }
  if (
    !response.ok
    || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')
  ) {
    throw new SmokeFailure('Assistant stream contract failed.')
  }
  if (!(await hasTerminalEvent(response))) {
    throw new SmokeFailure('Assistant terminal event missing.')
  }
  log('Assistant terminal event observed.')

  response = await safeFetch(fetcher, `${PRODUCTION_ORIGIN}/api/chat/transcript`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-chat-thread-id': threadId,
    },
  }, 'Assistant durable replay failed.')
  if (
    isRedirect(response)
    || !response.ok
    || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  ) {
    throw new SmokeFailure('Assistant durable replay failed.')
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new SmokeFailure('Assistant durable replay failed.')
  }
  const roles = Array.isArray(payload?.messages) ? payload.messages.map(({ role }) => role) : []
  if (roles.length < 2 || roles.at(-2) !== 'user' || roles.at(-1) !== 'assistant') {
    throw new SmokeFailure('Assistant durable replay failed.')
  }
  log('Assistant durable replay verified.')
}

async function sendHeartbeat(fetcher, heartbeatUrl) {
  if (!heartbeatUrl) return
  const response = await safeFetch(
    fetcher,
    heartbeatUrl,
    { method: 'POST' },
    'Canary heartbeat failed.',
  )
  if (isRedirect(response) || !response.ok) throw new SmokeFailure('Canary heartbeat failed.')
}

export async function runProductionSmoke({
  token,
  heartbeatUrl,
  fetcher = fetch,
  randomUUID = nodeRandomUUID,
  log = () => {},
} = {}) {
  await runContractChecks({ fetcher })
  log('Public page and API contracts verified.')
  await runAssistantCanary({ token, fetcher, randomUUID, log })
  await sendHeartbeat(fetcher, heartbeatUrl)
  if (heartbeatUrl) log('External heartbeat sent.')
}

async function main() {
  try {
    await runProductionSmoke({
      token: process.env.CHAT_EVALUATION_TOKEN,
      heartbeatUrl: process.env.CANARY_HEARTBEAT_URL,
      log: console.log,
    })
    console.log('Production observability smoke passed.')
  } catch (error) {
    const message = error instanceof SmokeFailure ? error.message : 'Production observability smoke failed.'
    console.error(message)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
