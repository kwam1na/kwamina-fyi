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
import { INSTRUCTIONS, MODEL, assistantTurnMetadata } from './chat-contract.js'

const MAX_OUTPUT_TOKENS = 640
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

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
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
export function finalizeAssistantStream(source, { onFinished, onFailed }) {
  let text = ''
  let settled = false

  async function* passthrough() {
    try {
      for await (const event of source) {
        if (event?.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string') {
          text += event.delta
        }

        // A failed run arrives as an event on the stream, not a rejected
        // promise, so the upstream message would otherwise reach the browser
        // verbatim — provider error text, request ids and all. Keep the real
        // one in the logs and hand the reader something they can act on.
        if (event?.type === 'RUN_ERROR') {
          settled = true
          await onFailed()
          console.error(JSON.stringify({
            event: 'chat.run_error',
            code: event.code,
            message: event.message,
          }))
          yield { ...event, message: 'The assistant could not answer that just now. Please try again.', rawEvent: undefined }
          return
        }

        if (event?.type === 'RUN_FINISHED') {
          settled = true
          if (text.trim()) await onFinished(text)
          else await onFailed()
        }

        yield event
      }
    } finally {
      if (!settled) await onFailed()
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
async function isRateLimited(request, env, ctx) {
  if (env.CHAT_RATE_LIMITER) {
    try {
      const address = request.headers.get('cf-connecting-ip')
      if (address) {
        const { success } = await env.CHAT_RATE_LIMITER.limit({ key: address })
        if (!success) return true
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'chat.ratelimit_binding_failed', message: String(error) }))
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
    console.error(JSON.stringify({ event: 'chat.ratelimit_db_failed', message: String(error) }))
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

const PAGE_CONTEXT_PATTERNS = [
  /\b(?:this|that) (?:page|article|story|reflection)\b/i,
  /\bwhat (?:am i|are we) (?:looking at|reading)\b/i,
  /\b(?:what(?:'s| is)|what about|tell me about|explain|summari[sz]e|describe|review).*\bhere\b/i,
  /^(?:and\s+|what about\s+)?this[?!.]*$/i,
  /\b(?:summari[sz]e|explain|describe|review|do) (?:this|that)\b/i,
]

// Attached only when the reader points at their surroundings. Supplying a page
// marker to every turn makes a standalone background question look page-scoped
// to the model, even though the full site corpus is available.
export function withPageMarker(content, pagePath) {
  const page = resolvePage(pagePath)
  const referencesPage = PAGE_CONTEXT_PATTERNS.some((pattern) => pattern.test(content.trim()))
  return page && referencesPage
    ? `[Reading: ${page.title} — ${page.path}]\n\n${content}`
    : content
}

async function handleChat(request, env, ctx) {
  // Ahead of every other check, including configuration: a flood should be
  // turned away cheaply whatever state the Worker is in.
  if (await isRateLimited(request, env, ctx)) {
    return jsonResponse({ error: 'That is a lot of questions at once. Give it a minute and try again.' }, 429)
  }

  if (!env.ANTHROPIC_API_KEY) {
    console.error(JSON.stringify({ event: 'chat.misconfigured', reason: 'missing ANTHROPIC_API_KEY' }))
    return jsonResponse({ error: 'The assistant is not configured yet.' }, 503)
  }

  let params
  try {
    params = await chatParamsFromRequestBody(await readJsonBody(request))
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: 'That request is too large.' }, 413)
    }
    return jsonResponse({ error: 'Malformed request.' }, 400)
  }

  if ((params.messages?.length ?? 0) > MAX_HISTORY_MESSAGES + 4) {
    return jsonResponse({ error: 'That request contains too many messages.' }, 413)
  }

  // The client mints this and keeps it in localStorage; it is the conversation
  // identity for the whole feature.
  const threadId = params.threadId
  if (typeof threadId !== 'string' || threadId.length < 8 || threadId.length > 100) {
    return jsonResponse({ error: 'Malformed request.' }, 400)
  }

  const userText = latestUserText(params.messages ?? []).trim()
  if (!userText) return jsonResponse({ error: 'Ask a question to get started.' }, 400)
  if (userText.length > MAX_MESSAGE_CHARS) {
    return jsonResponse({ error: `Questions are limited to ${MAX_MESSAGE_CHARS} characters.` }, 413)
  }

  const { conversation, history } = await loadConversation(env.DB, threadId)
  const rejection = rejectionFor(conversation, Date.now())
  if (rejection) return jsonResponse({ error: rejection.error }, rejection.status)

  const pagePath = params.forwardedProps?.pagePath
  const startedAt = Date.now()
  const turnToken = crypto.randomUUID()
  const initialMetadata = assistantTurnMetadata({
    requestUrl: request.url,
    expectedEvaluationToken: env.CHAT_EVALUATION_TOKEN,
    providedEvaluationToken: request.headers.get('x-chat-evaluation-token'),
    corpusVersion: CORPUS_VERSION,
    startedAt,
    completedAt: startedAt,
  })
  const reserved = await reserveTurn(env.DB, {
    threadId,
    startedAt,
    token: turnToken,
    ...initialMetadata.conversation,
  })
  if (!reserved) {
    return jsonResponse({ error: 'That conversation is already answering a question.' }, 409)
  }

  let stream
  try {
    stream = chat({
      adapter: createAnthropicChat(MODEL, env.ANTHROPIC_API_KEY),
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
    throw error
  }

  const events = finalizeAssistantStream(stream, {
    onFinished: async (assistantText) => {
      try {
        const metadata = assistantTurnMetadata({
          requestUrl: request.url,
          expectedEvaluationToken: env.CHAT_EVALUATION_TOKEN,
          providedEvaluationToken: request.headers.get('x-chat-evaluation-token'),
          corpusVersion: CORPUS_VERSION,
          startedAt,
          completedAt: Date.now(),
        })
        const persisted = await persistTurn(env.DB, {
          threadId,
          token: turnToken,
          assistant: { content: assistantText, ...metadata.assistant },
          conversation: metadata.conversation,
          user: { content: userText, pagePath: resolvePage(pagePath)?.path },
        })
        if (!persisted) throw new Error('Turn reservation was superseded before persistence.')
      } catch (error) {
        await releaseTurn(env.DB, threadId, turnToken)
        console.error(JSON.stringify({ event: 'chat.persist_failed', message: String(error) }))
        throw error
      }
    },
    onFailed: () => releaseTurn(env.DB, threadId, turnToken),
  })

  return toServerSentEventsResponse(events)
}

export async function loadTranscript(db, threadId) {
  return (await loadMessageWindow(db, threadId)).map(({ role, content, created_at }) => ({
    role,
    content,
    created_at,
  }))
}

async function handleTranscript(env, threadId) {
  return jsonResponse(
    { messages: await loadTranscript(env.DB, threadId) },
    200,
    { 'cache-control': 'private, no-store' },
  )
}

export default {
  // Rate-limit keys rotate daily and are dead the moment their window closes,
  // so nothing here needs to outlive the hour. Sweeping on a schedule keeps the
  // table from growing without bound and keeps the delete off the request path.
  async scheduled(event, env, ctx) {
    try {
      const result = await env.DB
        .prepare('DELETE FROM rate_limits WHERE window_start < ?')
        .bind(Date.now() - 3_600_000)
        .run()
      console.log(JSON.stringify({ event: 'ratelimits.swept', rows: result.meta?.changes ?? 0 }))
    } catch (error) {
      console.error(JSON.stringify({ event: 'ratelimits.sweep_failed', message: String(error) }))
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    try {
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        return await handleChat(request, env, ctx)
      }

      if (url.pathname === '/api/chat/transcript' && request.method === 'GET') {
        if (await isRateLimited(request, env, ctx)) {
          return jsonResponse({ error: 'Too many requests. Give it a minute and try again.' }, 429)
        }
        const threadId = request.headers.get('x-chat-thread-id')
        if (!threadId || !/^[A-Za-z0-9-]{8,100}$/.test(threadId)) {
          return jsonResponse({ error: 'Malformed request.' }, 400)
        }
        return await handleTranscript(env, threadId)
      }

      return jsonResponse({ error: 'Not found.' }, 404)
    } catch (error) {
      console.error(JSON.stringify({
        event: 'chat.unhandled_error',
        path: url.pathname,
        message: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }))
      return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500)
    }
  },
}
