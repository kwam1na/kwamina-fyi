// Backend for the site assistant.
//
// Two endpoints behind /api, everything else falls through to the static
// assets (see `run_worker_first` in wrangler.jsonc):
//
//   POST /api/chat              stream an answer, then persist the turn
//   GET  /api/chat/transcript   replay a stored transcript (thread id header)
//
// The whole site corpus rides in the system prompt rather than a retrieval
// index. Prompt caching means we pay for it once per five minutes rather than
// once per message.

import { chat, toServerSentEventsResponse, chatParamsFromRequestBody } from '@tanstack/ai'
import { createAnthropicChat } from '@tanstack/ai-anthropic'
import corpus, { CORPUS_VERSION, PAGES } from '../src/generated/corpus.js'
import { normalisePath } from '../src/routes.js'
import {
  INSTRUCTIONS,
  MODEL,
  assistantTurnMetadata,
  conversationSource,
  deploymentEnvironment,
} from './chat-contract.js'
import { createOperationId, createWorkerObservability } from './observability.js'

// Sized above the contract's word budgets with headroom: two site transcripts
// showed answers truncated mid-sentence at the old 640 cap.
const MAX_OUTPUT_TOKENS = 900
const MAX_MESSAGE_CHARS = 2000
const MAX_REQUEST_BYTES = 128_000
// Deep enough for a real follow-up thread, shallow enough that a long-lived
// conversation cannot grow the per-request cost without bound.
const MAX_HISTORY_MESSAGES = 30
const MIN_MS_BETWEEN_MESSAGES = 1500
// Per-caller ceiling. Well above anyone reading and asking follow-ups, low
// enough that a script cannot run up a bill unattended.
const CALLER_WINDOW_MS = 60_000
const CALLER_WINDOW_LIMIT = 15
const TURN_RESERVATION_STALE_MS = 120_000
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]{8,100}$/
const GENERIC_RUN_ERROR_MESSAGE = 'The assistant could not answer that just now. Please try again.'

class ReservationSupersededError extends Error {
  constructor() {
    super('Turn reservation was superseded before persistence.')
    this.name = 'ReservationSupersededError'
  }
}

const defaultObservability = createWorkerObservability({
  log: (event) => console.log(JSON.stringify(event)),
  captureIssue: (event) => console.error(JSON.stringify(event)),
})

const operationResponse = (response, operationId, runKind) => {
  response.headers.set('x-operation-id', operationId)
  if (runKind === 'synthetic') response.headers.set('x-run-kind', 'synthetic')
  return response
}

function requestObservation(request, env, operationId, event, extra = {}) {
  const source = conversationSource({
    expectedToken: env.CHAT_EVALUATION_TOKEN,
    providedToken: request.headers.get('x-chat-evaluation-token'),
  })
  return {
    event,
    route: request.url,
    environment: deploymentEnvironment(request.url),
    source,
    runKind: source === 'evaluation' ? 'synthetic' : 'human',
    operationId,
    ...extra,
  }
}

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const safeRunError = (code) => ({
  type: 'RUN_ERROR',
  code,
  message: GENERIC_RUN_ERROR_MESSAGE,
})

export async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RangeError('Request body is too large.')
  }
  if (!request.body) throw new SyntaxError('Request body is missing.')

  const reader = request.body.getReader()
  const chunks = []
  let length = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel()
      throw new RangeError('Request body is too large.')
    }
    chunks.push(value)
  }

  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return JSON.parse(new TextDecoder().decode(body))
}

// The client's own text for this turn. AG-UI sends the whole transcript it
// knows about; only the last user message is new, since prior turns are
// already durable in D1.
function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    const parts = Array.isArray(message.parts) ? message.parts : []
    return parts
      .filter((part) => part?.type === 'text')
      .map((part) => part.content)
      .join('')
  }
  return ''
}

async function loadMessageWindow(db, threadId) {
  // Oldest-first is what the model and transcript UI want, but the cap has to
  // keep the newest turns, so the window is taken from the end and reversed.
  const { results } = await db
    .prepare('SELECT role, content, page_path, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(threadId, MAX_HISTORY_MESSAGES)
    .all()

  return results.reverse()
}

async function loadConversation(db, threadId) {
  const conversation = await db
    .prepare('SELECT id, message_count, last_message_at FROM conversations WHERE id = ?')
    .bind(threadId)
    .first()

  if (!conversation) return { conversation: null, history: [] }

  return { conversation, history: await loadMessageWindow(db, threadId) }
}

// Reasons to refuse a turn before spending a model call on it. Per-conversation
// only: a determined abuser can mint a fresh thread id, so the IP-level limit
// belongs in a WAF rate-limiting rule on /api/chat (see docs/plans).
export function rejectionFor(conversation, now) {
  if (!conversation) return null
  if (now - conversation.last_message_at < MIN_MS_BETWEEN_MESSAGES) {
    return { status: 429, error: 'One moment — that was a little fast. Try again in a second.' }
  }
  return null
}

export async function reserveTurn(db, turn) {
  const staleBefore = turn.startedAt - TURN_RESERVATION_STALE_MS
  const [, reservation] = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO conversations (
        id, created_at, last_message_at, message_count,
        source, environment, turn_status, turn_started_at
      ) VALUES (?, ?, ?, 0, ?, ?, 'idle', NULL)
    `).bind(
      turn.threadId,
      turn.startedAt,
      turn.startedAt,
      turn.source,
      turn.environment,
    ),
    db.prepare(`
      UPDATE conversations
      SET turn_status = 'active', turn_started_at = ?, turn_token = ?
      WHERE id = ?
        AND (turn_status = 'idle' OR turn_started_at < ?)
      RETURNING id
    `).bind(turn.startedAt, turn.token, turn.threadId, staleBefore),
  ])

  return (reservation.results?.length ?? 0) === 1
}

export async function releaseTurn(db, threadId, token) {
  await db
    .prepare("UPDATE conversations SET turn_status = 'idle', turn_started_at = NULL, turn_token = NULL WHERE id = ? AND turn_token = ?")
    .bind(threadId, token)
    .run()
}

export async function persistTurn(db, turn) {
  const now = Date.now()
  const statements = []

  statements.push(
    // The page is stored raw alongside the message and only turned into a
    // marker when the transcript is replayed, so the stored text stays exactly
    // what the reader typed — the transcript endpoint serves it verbatim.
    db.prepare(`
      INSERT INTO messages (conversation_id, role, content, created_at, page_path)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM conversations
        WHERE id = ? AND turn_status = 'active' AND turn_token = ?
      )
    `).bind(turn.threadId, 'user', turn.user.content, now, turn.user.pagePath ?? null, turn.threadId, turn.token),
    db.prepare(`
      INSERT INTO messages (
        conversation_id, role, content, created_at,
        assistant_version, corpus_version, model, latency_ms
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM conversations
        WHERE id = ? AND turn_status = 'active' AND turn_token = ?
      )
    `).bind(
      turn.threadId,
      'assistant',
      turn.assistant.content,
      now + 1,
      turn.assistant.version,
      turn.assistant.corpusVersion,
      turn.assistant.model,
      turn.assistant.latencyMs,
      turn.threadId,
      turn.token,
    ),
    db.prepare("UPDATE conversations SET last_message_at = ?, message_count = message_count + 2, turn_status = 'idle', turn_started_at = NULL, turn_token = NULL WHERE id = ? AND turn_token = ?")
      .bind(now, turn.threadId, turn.token),
  )

  const results = await db.batch(statements)
  return results.at(-1)?.meta?.changes === 1
}

// Pass content events through immediately, but hold the terminal success event
// until the completed turn is durable. That keeps visible token latency low
// while ensuring a close/reopen after RUN_FINISHED cannot replay stale history.
// Failed or interrupted runs release their reservation and are never stored as
// successful assistant messages.
export function finalizeAssistantStream(source, {
  onFinished,
  onFailed,
  onLifecycle = () => {},
  now = () => Date.now(),
  signal,
  startedAt = now(),
}) {
  let text = ''
  let settled = false
  let exhausted = false
  let sawContent = false
  let persisting = false

  const record = (stage, outcomeCode, durationMs) => {
    try {
      onLifecycle({ stage, outcomeCode, ...(durationMs === undefined ? {} : { durationMs }) })
    } catch {
      // Lifecycle observation is best-effort and cannot alter the stream.
    }
  }

  const settleCancellation = async () => {
    settled = true
    await onFailed('stream_cancelled')
    record('stream', 'STREAM_CANCELLED')
  }

  async function* passthrough() {
    record('model_start', 'MODEL_STARTED')
    try {
      for await (const event of source) {
        if (event?.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string') {
          text += event.delta
          if (!sawContent && event.delta.length > 0) {
            sawContent = true
            record('first_content', 'CONTENT_STARTED', now() - startedAt)
          }
        }

        // A failed run arrives as an event on the stream, not a rejected
        // promise, so the upstream message would otherwise reach the browser
        // verbatim — provider error text, request ids and all. Keep the real
        // one in the logs and hand the reader something they can act on.
        if (event?.type === 'RUN_ERROR') {
          settled = true
          await onFailed('provider_error')
          record('stream', 'MODEL_FAILED')
          yield safeRunError('MODEL_FAILED')
          return
        }

        if (event?.type === 'RUN_FINISHED') {
          if (!text.trim()) {
            settled = true
            await onFailed('empty_completion')
            record('stream', 'EMPTY_COMPLETION')
            yield safeRunError('EMPTY_COMPLETION')
            return
          }

          record('stream', 'STREAM_COMPLETED', now() - startedAt)
          persisting = true
          await onFinished(text)
          persisting = false
          record('persistence', 'PERSISTENCE_COMMITTED', now() - startedAt)
          settled = true
          try {
            yield event
          } finally {
            const durableDurationMs = now() - startedAt
            record('terminal', 'TERMINAL_EMITTED', durableDurationMs)
            record('terminal', 'SERVER_DURABLE_SUCCESS', durableDurationMs)
          }
          return
        }

        yield event
      }
      if (signal?.aborted) {
        await settleCancellation()
        return
      }
      exhausted = true
      await onFailed('source_exhausted')
      record('stream', 'SOURCE_EXHAUSTED')
    } catch (error) {
      if (!settled) {
        if (signal?.aborted) {
          await settleCancellation()
          return
        }
        settled = true
        if (persisting) {
          await onFailed('persistence_failed')
          record('persistence', 'PERSISTENCE_FAILED')
          yield safeRunError('PERSISTENCE_FAILED')
        } else {
          await onFailed('source_failed')
          record('stream', 'SOURCE_FAILED')
          yield safeRunError('SOURCE_FAILED')
        }
        return
      }
      throw error
    } finally {
      if (!settled && !exhausted) {
        settled = true
        await onFailed('stream_cancelled')
        record('stream', 'STREAM_CANCELLED')
      }
    }
  }

  return passthrough()
}

// A counter key for the caller, not a record of who they are. HMAC prevents a
// D1 reader from enumerating IPv4 addresses, while the day rotates the key so
// old rows stop matching new requests.
export async function callerKey(request, secret) {
  const address = request.headers.get('cf-connecting-ip')
  if (!address) return null
  if (!secret) throw new Error('RATE_LIMIT_KEY is not configured')

  const day = Math.floor(Date.now() / 86_400_000)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}:${address}`))

  return [...new Uint8Array(digest).slice(0, 10)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Two limits, because neither is sufficient alone.
//
// CHAT_RATE_LIMITER is fast and free but permissive: measured against
// production, a burst of 30 parallel requests tripped it while 40 sequential
// ones did not, because its counters do not span the isolates a paced sequence
// lands on. It catches floods.
//
// The D1 count catches what the binding misses. One primary means one count, so
// pacing does not evade it. It costs a write per request, which is the price of
// the guarantee.
//
// Both are keyed on the caller, so a script minting a fresh thread id per
// request — the gap the per-conversation limits leave open — is bounded by
// these and nothing else. Anyone behind a shared address shares the count,
// which is why the ceiling sits well above a reading human's pace.
async function isRateLimited(request, env, ctx, onIssue = () => {}) {
  const reportIssue = (outcomeCode) => {
    try {
      onIssue(outcomeCode)
    } catch {
      // Rate-limit diagnostics never alter admission behavior.
    }
  }

  if (env.CHAT_RATE_LIMITER) {
    try {
      const address = request.headers.get('cf-connecting-ip')
      if (address) {
        const { success } = await env.CHAT_RATE_LIMITER.limit({ key: address })
        if (!success) return true
      }
    } catch (error) {
      reportIssue('RATE_LIMIT_BINDING_FAILED')
    }
  }

  const now = Date.now()
  try {
    const key = await callerKey(request, env.RATE_LIMIT_KEY)
    if (!key) return false

    // One statement so the read and the increment cannot interleave with a
    // concurrent request's. A window older than the period resets in place
    // rather than needing its own delete.
    const row = await env.DB
      .prepare(`
        INSERT INTO rate_limits (id, window_start, count) VALUES (?1, ?2, 1)
        ON CONFLICT(id) DO UPDATE SET
          count = CASE WHEN ?2 - rate_limits.window_start >= ?3 THEN 1 ELSE rate_limits.count + 1 END,
          window_start = CASE WHEN ?2 - rate_limits.window_start >= ?3 THEN ?2 ELSE rate_limits.window_start END
        RETURNING count
      `)
      .bind(key, now, CALLER_WINDOW_MS)
      .first()

    return (row?.count ?? 0) > CALLER_WINDOW_LIMIT
  } catch (error) {
    // Losing the counter must not take the assistant down with it; the binding
    // above still stands between an attacker and the model.
    reportIssue('RATE_LIMIT_D1_FAILED')
    return false
  }
}

// What the reader means by "this page". The browser reports where it is; what
// comes back is an entry from PAGES — a table generated alongside the corpus —
// so an unrecognised or hostile path resolves to nothing rather than putting a
// sentence of the caller's choosing anywhere near the model.
//
// Returns null when there is no match, which leaves the model to ask which page
// they mean rather than guess at one.
export function resolvePage(claimed) {
  if (typeof claimed !== 'string' || claimed.length > 200) return null

  const wanted = normalisePath(claimed)
  return PAGES.find((candidate) => normalisePath(candidate.path) === wanted) ?? null
}

// Attached to every turn that arrives from a real page. An earlier version
// gated this behind regexes guessing whether the question pointed at the
// reader's surroundings, and the transcripts showed the guess losing:
// "tell me about this" — the most common phrasing — matched nothing, so
// visitors sitting on a page were asked which page they meant. Deciding
// whether a question is about the page in front of the reader is language
// judgment, and the model is the component that has it; the contract tells it
// when the marker matters and when to ignore it.
export function withPageMarker(content, pagePath) {
  const page = resolvePage(pagePath)
  return page
    ? `[Reading: ${page.title} — ${page.path}]\n\n${content}`
    : content
}

async function handleChat(request, env, ctx, operationId, observability, now, startedAt) {
  const observe = (method, event, extra) => observability[method](
    requestObservation(request, env, operationId, event, extra),
  )

  // Ahead of every other check, including configuration: a flood should be
  // turned away cheaply whatever state the Worker is in.
  if (await isRateLimited(request, env, ctx, (outcomeCode) => {
    observe('captureActionableIssue', 'assistant.issue', {
      stage: 'admission', outcomeCode, statusClass: '5xx',
    })
  })) {
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'admission', outcomeCode: 'RATE_LIMITED', statusClass: '4xx',
    })
    return jsonResponse({ error: 'That is a lot of questions at once. Give it a minute and try again.' }, 429)
  }

  if (!env.ANTHROPIC_API_KEY) {
    observe('captureActionableIssue', 'assistant.issue', {
      stage: 'admission', outcomeCode: 'CONFIGURATION_MISSING', statusClass: '5xx',
    })
    return jsonResponse({ error: 'The assistant is not configured yet.' }, 503)
  }

  let params
  try {
    params = await chatParamsFromRequestBody(await readJsonBody(request))
  } catch (error) {
    if (error instanceof RangeError) {
      observe('recordExpectedRefusal', 'assistant.refused', {
        stage: 'admission', outcomeCode: 'REQUEST_TOO_LARGE', statusClass: '4xx',
      })
      return jsonResponse({ error: 'That request is too large.' }, 413)
    }
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'admission', outcomeCode: 'ADMISSION_REJECTED', statusClass: '4xx',
    })
    return jsonResponse({ error: 'Malformed request.' }, 400)
  }

  if ((params.messages?.length ?? 0) > MAX_HISTORY_MESSAGES + 4) {
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'admission', outcomeCode: 'REQUEST_TOO_LARGE', statusClass: '4xx',
    })
    return jsonResponse({ error: 'That request contains too many messages.' }, 413)
  }

  // The client mints this and keeps it in localStorage; it is the conversation
  // identity for the whole feature.
  const threadId = params.threadId
  if (typeof threadId !== 'string' || threadId.length < 8 || threadId.length > 100) {
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'admission', outcomeCode: 'ADMISSION_REJECTED', statusClass: '4xx',
    })
    return jsonResponse({ error: 'Malformed request.' }, 400)
  }

  const userText = latestUserText(params.messages ?? []).trim()
  if (!userText) {
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'admission', outcomeCode: 'ADMISSION_REJECTED', statusClass: '4xx',
    })
    return jsonResponse({ error: 'Ask a question to get started.' }, 400)
  }
  if (userText.length > MAX_MESSAGE_CHARS) {
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'admission', outcomeCode: 'REQUEST_TOO_LARGE', statusClass: '4xx',
    })
    return jsonResponse({ error: `Questions are limited to ${MAX_MESSAGE_CHARS} characters.` }, 413)
  }

  const { conversation, history } = await loadConversation(env.DB, threadId)
  const rejection = rejectionFor(conversation, now())
  if (rejection) {
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'admission', outcomeCode: 'RATE_LIMITED', statusClass: '4xx',
    })
    return jsonResponse({ error: rejection.error }, rejection.status)
  }

  observe('record', 'assistant.operation', {
    stage: 'admission', outcomeCode: 'ADMITTED', statusClass: '2xx',
  })

  const pagePath = params.forwardedProps?.pagePath
  const turnToken = crypto.randomUUID()
  const initialMetadata = assistantTurnMetadata({
    requestUrl: request.url,
    expectedEvaluationToken: env.CHAT_EVALUATION_TOKEN,
    providedEvaluationToken: request.headers.get('x-chat-evaluation-token'),
    corpusVersion: CORPUS_VERSION,
    startedAt,
    completedAt: startedAt,
  })
  const reservationStartedAt = now()
  const reserved = await reserveTurn(env.DB, {
    threadId,
    startedAt,
    token: turnToken,
    ...initialMetadata.conversation,
  })
  if (!reserved) {
    observe('recordExpectedRefusal', 'assistant.refused', {
      stage: 'reservation',
      outcomeCode: 'RESERVATION_CONFLICT',
      statusClass: '4xx',
      durationMs: now() - reservationStartedAt,
    })
    return jsonResponse({ error: 'That conversation is already answering a question.' }, 409)
  }
  observe('record', 'assistant.operation', {
    stage: 'reservation',
    outcomeCode: 'RESERVATION_ACQUIRED',
    statusClass: '2xx',
    durationMs: now() - reservationStartedAt,
  })

  let stream
  const abortController = new AbortController()
  try {
    const runChat = env.WORKER_CHAT ?? chat
    stream = runChat({
      adapter: createAnthropicChat(MODEL, env.ANTHROPIC_API_KEY),
      abortController,
      threadId,
    // Server-side history is authoritative: the client's copy is replayed for
    // rendering, but what the model sees comes from D1, so a tampered or stale
    // client payload cannot rewrite the conversation.
    //
    // Contextual reader turns carry the page they were asked from, this one
    // included. Assistant turns are left alone — they were written against the
    // marker on the question above them.
    messages: [
      ...history.map((message) => (
        message.role === 'user'
          ? { role: 'user', content: withPageMarker(message.content, message.page_path) }
          : { role: message.role, content: message.content }
      )),
      { role: 'user', content: withPageMarker(userText, pagePath) },
    ],
    systemPrompts: [
      {
        content: `${INSTRUCTIONS}\n\n${corpus}`,
        // Byte-identical across requests, so it caches — which is what makes
        // the whole system prompt practical. Nothing volatile is appended
        // after it: the per-turn page context rides on the messages,
        // where it belongs, so the cached prefix is the entire system prompt.
        metadata: { cache_control: { type: 'ephemeral' } },
      },
    ],
      modelOptions: { max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.2 },
    })
  } catch (error) {
    await releaseTurn(env.DB, threadId, turnToken)
    observe('captureActionableIssue', 'assistant.issue', {
      stage: 'model_start', outcomeCode: 'MODEL_FAILED', statusClass: '5xx',
    })
    throw error
  }

  const events = finalizeAssistantStream(stream, {
    onFinished: async (assistantText) => {
      observe('record', 'assistant.operation', {
        stage: 'persistence',
        outcomeCode: 'PERSISTENCE_STARTED',
        statusClass: '2xx',
        durationMs: now() - startedAt,
      })
      try {
        const metadata = assistantTurnMetadata({
          requestUrl: request.url,
          expectedEvaluationToken: env.CHAT_EVALUATION_TOKEN,
          providedEvaluationToken: request.headers.get('x-chat-evaluation-token'),
          corpusVersion: CORPUS_VERSION,
          startedAt,
          completedAt: now(),
        })
        const persisted = await persistTurn(env.DB, {
          threadId,
          token: turnToken,
          assistant: { content: assistantText, ...metadata.assistant },
          conversation: metadata.conversation,
          user: { content: userText, pagePath: resolvePage(pagePath)?.path },
        })
        if (!persisted) {
          observe('captureActionableIssue', 'assistant.issue', {
            stage: 'persistence', outcomeCode: 'RESERVATION_SUPERSEDED', statusClass: '5xx',
          })
          throw new ReservationSupersededError()
        }
      } catch (error) {
        if (!(error instanceof ReservationSupersededError)) {
          observe('captureActionableIssue', 'assistant.issue', {
            stage: 'persistence', outcomeCode: 'PERSISTENCE_FAILED', statusClass: '5xx',
          })
        }
        throw error
      }
    },
    onFailed: () => releaseTurn(env.DB, threadId, turnToken),
    onLifecycle: ({ stage, outcomeCode, durationMs }) => {
      const actionable = ['MODEL_FAILED', 'EMPTY_COMPLETION', 'SOURCE_FAILED', 'SOURCE_EXHAUSTED'].includes(outcomeCode)
      observe(actionable ? 'captureActionableIssue' : 'record', actionable ? 'assistant.issue' : 'assistant.operation', {
        stage,
        outcomeCode,
        statusClass: actionable ? '5xx' : '2xx',
        durationMs,
      })
    },
    now,
    signal: abortController.signal,
    startedAt,
  })

  return toServerSentEventsResponse(events, { abortController })
}

export async function loadTranscript(db, threadId) {
  return (await loadMessageWindow(db, threadId)).map(({ role, content, created_at }) => ({
    role,
    content,
    created_at,
  }))
}

async function handleTranscript(env, threadId, request, operationId, observability) {
  const startedAt = Date.now()
  observability.record(requestObservation(request, env, operationId, 'assistant.replay', {
    stage: 'replay', outcomeCode: 'REPLAY_STARTED', statusClass: '2xx',
  }))
  const messages = await loadTranscript(env.DB, threadId)
  observability.record(requestObservation(request, env, operationId, 'assistant.replay', {
    stage: 'replay',
    outcomeCode: messages.length ? 'REPLAY_NONEMPTY' : 'REPLAY_EMPTY',
    statusClass: '2xx',
    durationMs: Date.now() - startedAt,
  }))
  return jsonResponse(
    { messages },
    200,
    { 'cache-control': 'private, no-store' },
  )
}

export default {
  // Rate-limit keys rotate daily and are dead the moment their window closes,
  // so nothing here needs to outlive the hour. Sweeping on a schedule keeps the
  // table from growing without bound and keeps the delete off the request path.
  async scheduled(event, env, ctx) {
    const observability = env.WORKER_OBSERVABILITY ?? defaultObservability
    try {
      const result = await env.DB
        .prepare('DELETE FROM rate_limits WHERE window_start < ?')
        .bind(Date.now() - 3_600_000)
        .run()
      observability.record({
        event: 'worker.operation',
        route: 'scheduled',
        environment: env.ENVIRONMENT ?? 'production',
        outcomeCode: 'RATE_LIMIT_SWEEP_COMPLETED',
        occurrences: result.meta?.changes ?? 0,
      })
    } catch (error) {
      observability.captureActionableIssue({
        event: 'worker.issue',
        route: 'scheduled',
        environment: env.ENVIRONMENT ?? 'production',
        outcomeCode: 'RATE_LIMIT_SWEEP_FAILED',
      })
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const isChatRoute = url.pathname === '/api/chat'
    const isTranscriptRoute = url.pathname === '/api/chat/transcript'
    const operationId = isChatRoute || isTranscriptRoute ? createOperationId() : null
    const observability = env.WORKER_OBSERVABILITY ?? defaultObservability
    const now = typeof env.WORKER_NOW === 'function' ? env.WORKER_NOW : () => Date.now()
    const operationStartedAt = operationId ? now() : null
    const runKind = (isChatRoute || isTranscriptRoute)
      && conversationSource({
        expectedToken: env.CHAT_EVALUATION_TOKEN,
        providedToken: request.headers.get('x-chat-evaluation-token'),
      }) === 'evaluation'
      ? 'synthetic'
      : undefined

    try {
      if (isChatRoute && request.method === 'POST') {
        return operationResponse(
          await handleChat(request, env, ctx, operationId, observability, now, operationStartedAt),
          operationId,
          runKind,
        )
      }

      if (isTranscriptRoute && request.method === 'GET') {
        if (await isRateLimited(request, env, ctx, (outcomeCode) => {
          observability.captureActionableIssue(requestObservation(request, env, operationId, 'assistant.issue', {
            stage: 'admission', outcomeCode, statusClass: '5xx',
          }))
        })) {
          observability.recordExpectedRefusal(requestObservation(request, env, operationId, 'assistant.refused', {
            stage: 'admission', outcomeCode: 'RATE_LIMITED', statusClass: '4xx',
          }))
          return operationResponse(jsonResponse({ error: 'Too many requests. Give it a minute and try again.' }, 429), operationId, runKind)
        }
        const threadId = request.headers.get('x-chat-thread-id')
        if (!threadId || !THREAD_ID_PATTERN.test(threadId)) {
          observability.recordExpectedRefusal(requestObservation(request, env, operationId, 'assistant.refused', {
            stage: 'admission', outcomeCode: 'ADMISSION_REJECTED', statusClass: '4xx',
          }))
          return operationResponse(jsonResponse({ error: 'Malformed request.' }, 400), operationId, runKind)
        }
        try {
          return operationResponse(
            await handleTranscript(env, threadId, request, operationId, observability),
            operationId,
            runKind,
          )
        } catch (error) {
          observability.captureActionableIssue(requestObservation(request, env, operationId, 'assistant.issue', {
            stage: 'replay', outcomeCode: 'REPLAY_FAILED', statusClass: '5xx',
          }))
          throw error
        }
      }

      const response = jsonResponse({ error: 'Not found.' }, 404)
      return operationId ? operationResponse(response, operationId, runKind) : response
    } catch (error) {
      if (operationId) {
        observability.captureActionableIssue(requestObservation(request, env, operationId, 'assistant.issue', {
          stage: isTranscriptRoute ? 'replay' : 'stream',
          outcomeCode: 'UNHANDLED_FAILURE',
          statusClass: '5xx',
        }))
      }
      const response = jsonResponse({ error: 'Something went wrong. Please try again.' }, 500)
      return operationId ? operationResponse(response, operationId, runKind) : response
    }
  },
}
