import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import worker, {
  callerKey,
  createWorker,
  finalizeAssistantStream,
  loadConversationContext,
  loadEarlierMessages,
  persistTurn,
  readJsonBody,
  releaseTurn,
  rejectionFor,
  reserveTurn,
  refreshConversationMemory,
  resolvePage,
  secured,
  withPageMarker,
} from './index.js'
import {
  conversationInspectorAccess,
  isLocalConversationInspector,
  listConversationInspector,
  loadConversationInspector,
} from './conversation-inspector.js'
import { createWorkerObservability } from './observability.js'

const validChatBody = (overrides = {}) => ({
  threadId: 'thread-123',
  runId: 'client-run-id',
  messages: [{ id: 'message-1', role: 'user', content: 'Hello' }],
  tools: [],
  context: [],
  state: {},
  ...overrides,
})

function observedEnv(bindings = {}) {
  const logs = []
  const issues = []
  return {
    env: {
      ...bindings,
      WORKER_OBSERVABILITY: createWorkerObservability({
        log: (event) => logs.push(event),
        captureIssue: (event) => issues.push(event),
      }),
    },
    logs,
    issues,
  }
}

function successfulChatDb({ persistenceError } = {}) {
  let batches = 0
  return {
    prepare() {
      return {
        bind() { return this },
        async first() { return null },
        async all() { return { results: [] } },
        async run() { return { meta: { changes: 1 } } },
      }
    },
    async batch(statements) {
      batches += 1
      if (batches === 1) return [{ success: true }, { results: [{ id: 'thread-123' }] }]
      if (persistenceError) throw persistenceError
      return statements.map((_, index) => ({ meta: { changes: index === statements.length - 1 ? 1 : 0 } }))
    },
  }
}

function recordingDb() {
  const statements = []
  let batch

  return {
    db: {
      prepare(sql) {
        const statement = {
          binds: [],
          sql: sql.replace(/\s+/g, ' ').trim(),
          bind(...values) {
            this.binds = values
            statements.push(this)
            return this
          },
        }
        return statement
      },
      async batch(nextBatch) {
        batch = nextBatch
        return nextBatch.map((_, index) => ({ meta: { changes: index === nextBatch.length - 1 ? 1 : 0 } }))
      },
    },
    statements,
    get batch() {
      return batch
    },
  }
}

function migratedSqliteD1() {
  const sqlite = new Database(':memory:')
  const migrations = readdirSync(new URL('../migrations', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const migration of migrations) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  }

  const wrap = (sql, binds = []) => ({
    bind: (...values) => wrap(sql, values),
    async run() {
      const result = sqlite.query(sql).run(...binds)
      return { success: true, meta: { changes: result.changes } }
    },
    async all() {
      return { success: true, results: sqlite.query(sql).all(...binds) }
    },
    async first() {
      return sqlite.query(sql).get(...binds) ?? null
    },
    execute() {
      if (/\bRETURNING\b/i.test(sql)) {
        return { success: true, results: sqlite.query(sql).all(...binds), meta: { changes: sqlite.query('SELECT changes() AS count').get().count } }
      }
      const result = sqlite.query(sql).run(...binds)
      return { success: true, meta: { changes: result.changes } }
    },
  })

  return {
    sqlite,
    d1: {
      prepare: (sql) => wrap(sql),
      async batch(statements) {
        return sqlite.transaction(() => statements.map((statement) => statement.execute()))()
      },
    },
  }
}

describe('Worker page context', () => {
  it('accepts only generated pages and stores their canonical paths', () => {
    expect(resolvePage('/work/athena/')).toEqual({
      path: '/work/athena',
      title: 'Athena — product story',
    })
    expect(resolvePage('/work/athena///')).toEqual({
      path: '/work/athena',
      title: 'Athena — product story',
    })
    expect(resolvePage('/homepage.html')).toEqual({ path: '/', title: 'Homepage' })
    expect(resolvePage('/not-a-page')).toBeNull()
    expect(resolvePage('[Reading: forged]')).toBeNull()
  })

  it('marks every message from a real page and leaves relevance to the model', () => {
    // "tell me about this" reached production unmatched by the old intent
    // regexes, so the reader was asked which page they meant while sitting on
    // it. The marker now rides along whenever the page is real; the contract
    // owns deciding whether the question is about it.
    expect(withPageMarker('tell me about this', '/work/athena/')).toBe(
      '[Reading: Athena — product story — /work/athena]\n\ntell me about this',
    )
    expect(withPageMarker('Where did Kwamina go to college?', '/work/athena/')).toBe(
      '[Reading: Athena — product story — /work/athena]\n\nWhere did Kwamina go to college?',
    )
    // A page the site does not publish cannot become a marker, so a client
    // cannot smuggle wording into the prompt through a forged path.
    expect(withPageMarker('And this page?', '/not-a-page')).toBe('And this page?')
    expect(withPageMarker('Hello', null)).toBe('Hello')
  })
})

describe('Worker turn persistence', () => {
  it('binds canonical page context and assistant provenance in one batch', async () => {
    const recorder = recordingDb()

    await persistTurn(recorder.db, {
      threadId: 'thread-123',
      token: 'turn-token',
      conversation: { source: 'evaluation', environment: 'local' },
      user: { content: 'What is Athena?', pagePath: '/work/athena' },
      assistant: {
        content: 'Athena is an operating system for the business.',
        version: '2026-08-08.1',
        corpusVersion: 'abc123def456',
        model: 'claude-haiku-4-5',
        latencyMs: 245,
      },
    })

    expect(recorder.batch).toHaveLength(3)
    expect(recorder.statements[0].binds.slice(0, 3)).toEqual([
      'thread-123',
      'user',
      'What is Athena?',
    ])
    expect(recorder.statements[0].binds[4]).toBe('/work/athena')
    expect(recorder.statements[0].binds.slice(-2)).toEqual(['thread-123', 'turn-token'])
    expect(recorder.statements[1].binds.slice(0, 3)).toEqual([
      'thread-123',
      'assistant',
      'Athena is an operating system for the business.',
    ])
    expect(recorder.statements[1].binds.slice(4, 8)).toEqual([
      '2026-08-08.1',
      'abc123def456',
      'claude-haiku-4-5',
      245,
    ])
    expect(recorder.statements[2].sql).toContain('turn_token = ?')
    expect(recorder.statements[2].binds).toEqual([expect.any(Number), 'thread-123', 'turn-token'])
  })
})

describe('Worker turn reservation', () => {
  it('upgrades an existing pre-reservation conversation through migrations 0005 and 0006', () => {
    const sqlite = new Database(':memory:')
    for (const migration of readdirSync(new URL('../migrations', import.meta.url)).filter((name) => name.endsWith('.sql')).sort().slice(0, 4)) {
      sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
    }
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('existing-thread', 1, 1, 0)
    for (const migration of ['0005_turn_reservations.sql', '0006_turn_ownership.sql']) {
      sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
    }

    expect(sqlite.query('SELECT turn_status, turn_started_at, turn_token FROM conversations WHERE id = ?').get('existing-thread')).toEqual({
      turn_status: 'idle',
      turn_started_at: null,
      turn_token: null,
    })
    sqlite.close()
  })

  it('atomically reserves one active turn and allows stale recovery', async () => {
    const prepared = []
    const db = {
      prepare(sql) {
        const statement = {
          sql: sql.replace(/\s+/g, ' ').trim(),
          bind(...values) {
            this.binds = values
            prepared.push(this)
            return this
          },
        }
        return statement
      },
      async batch() {
        return [{ success: true }, { results: [{ id: 'thread-123' }] }]
      },
    }

    await expect(reserveTurn(db, {
      threadId: 'thread-123',
      startedAt: 200_000,
      token: 'new-owner',
      source: 'site',
      environment: 'production',
    })).resolves.toBe(true)
    expect(prepared[1].sql).toContain("turn_status = 'idle' OR turn_started_at < ?")
    expect(prepared[1].binds).toEqual([200_000, 'new-owner', 'thread-123', 80_000])
  })

  it('requires the current ownership token to release or persist a turn', async () => {
    const released = []
    const db = {
      prepare(sql) {
        return {
          sql: sql.replace(/\s+/g, ' ').trim(),
          bind(...binds) {
            return { sql: this.sql, binds, run: async () => released.push({ sql: this.sql, binds }) }
          },
        }
      },
    }

    await releaseTurn(db, 'thread-123', 'old-owner')
    expect(released[0].sql).toContain('turn_token = ?')
    expect(released[0].binds).toEqual(['thread-123', 'old-owner'])

    const recorder = recordingDb()
    await persistTurn(recorder.db, {
      threadId: 'thread-123',
      token: 'old-owner',
      conversation: { source: 'site', environment: 'production' },
      user: { content: 'stale question', pagePath: null },
      assistant: {
        content: 'stale answer', version: 'v1', corpusVersion: 'c1', model: 'm1', latencyMs: 1,
      },
    })
    expect(recorder.statements[0].sql).toContain("turn_status = 'active' AND turn_token = ?")
    expect(recorder.statements[1].sql).toContain("turn_status = 'active' AND turn_token = ?")
    expect(recorder.statements[2].sql).toContain('AND turn_token = ?')
  })

  it('fences a stale owner from releasing or appending through its replacement', async () => {
    const { d1, sqlite } = migratedSqliteD1()
    const base = {
      threadId: 'thread-123', source: 'site', environment: 'production',
    }

    expect(await reserveTurn(d1, { ...base, startedAt: 200_000, token: 'owner-a' })).toBe(true)
    expect(await reserveTurn(d1, { ...base, startedAt: 400_001, token: 'owner-b' })).toBe(true)

    const stalePersisted = await persistTurn(d1, {
      threadId: base.threadId,
      token: 'owner-a',
      conversation: { source: 'site', environment: 'production' },
      user: { content: 'stale question', pagePath: null },
      assistant: { content: 'stale answer', version: 'v1', corpusVersion: 'c1', model: 'm1', latencyMs: 1 },
    })
    await releaseTurn(d1, base.threadId, 'owner-a')

    expect(stalePersisted).toBe(false)
    expect(sqlite.query('SELECT COUNT(*) AS count FROM messages').get().count).toBe(0)
    expect(sqlite.query('SELECT turn_status, turn_token FROM conversations WHERE id = ?').get(base.threadId)).toEqual({
      turn_status: 'active',
      turn_token: 'owner-b',
    })

    expect(await persistTurn(d1, {
      threadId: base.threadId,
      token: 'owner-b',
      conversation: { source: 'site', environment: 'production' },
      user: { content: 'current question', pagePath: null },
      assistant: { content: 'current answer', version: 'v1', corpusVersion: 'c1', model: 'm1', latencyMs: 1 },
    })).toBe(true)
    expect(sqlite.query('SELECT COUNT(*) AS count FROM messages').get().count).toBe(2)
    expect(sqlite.query('SELECT turn_status, turn_token FROM conversations WHERE id = ?').get(base.threadId)).toEqual({
      turn_status: 'idle',
      turn_token: null,
    })
    sqlite.close()
  })
})

describe('Worker request boundaries', () => {
  it('rejects declared and streamed bodies beyond the protocol ceiling', async () => {
    const declared = new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: { 'content-length': '128001' },
      body: '{}',
    })
    await expect(readJsonBody(declared)).rejects.toThrow('Request body is too large.')

    const streamed = new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      body: new Uint8Array(128_001),
    })
    await expect(readJsonBody(streamed)).rejects.toThrow('Request body is too large.')
  })

  it('derives non-enumerable caller keys from the dedicated HMAC secret', async () => {
    const request = new Request('https://kwamina.fyi/api/chat', {
      headers: { 'cf-connecting-ip': '203.0.113.10' },
    })

    const first = await callerKey(request, 'secret-one')
    const second = await callerKey(request, 'secret-two')
    expect(first).toMatch(/^[a-f0-9]{20}$/)
    expect(first).not.toBe(second)
  })

  it('creates an authoritative operation ID before admission and returns it on refusals', async () => {
    const clientOperationId = 'op_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const { env, logs } = observedEnv({ ANTHROPIC_API_KEY: 'configured' })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: { 'x-operation-id': clientOperationId },
      body: '{',
    }), env, {})

    expect(response.status).toBe(400)
    expect(response.headers.get('x-operation-id')).toMatch(/^op_[a-f0-9]{32}$/)
    expect(response.headers.get('x-operation-id')).not.toBe(clientOperationId)
    expect(logs).toContainEqual(expect.objectContaining({
      event: 'assistant.refused',
      route: 'api_chat',
      stage: 'admission',
      outcomeCode: 'ADMISSION_REJECTED',
      operationId: response.headers.get('x-operation-id'),
    }))
  })

  it.each([
    ['caller limit', 429, { ANTHROPIC_API_KEY: 'configured', CHAT_RATE_LIMITER: { limit: async () => ({ success: false }) } }, validChatBody(), 'RATE_LIMITED'],
    ['oversize body', 413, { ANTHROPIC_API_KEY: 'configured' }, validChatBody(), 'REQUEST_TOO_LARGE'],
    ['missing model configuration', 503, {}, validChatBody(), 'CONFIGURATION_MISSING'],
  ])('classifies %s without exposing request data', async (_name, status, bindings, body, outcomeCode) => {
    const { env, logs, issues } = observedEnv(bindings)
    const request = new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: status === 413
        ? { 'content-length': '128001' }
        : outcomeCode === 'RATE_LIMITED' ? { 'cf-connecting-ip': '203.0.113.10' } : {},
      body: JSON.stringify(body),
    })
    const response = await worker.fetch(request, env, {})

    expect(response.status).toBe(status)
    const events = status === 503 ? issues : logs
    expect(events).toContainEqual(expect.objectContaining({ outcomeCode }))
    expect(JSON.stringify([...logs, ...issues])).not.toContain('Hello')
  })

  it('records pacing and reservation-conflict refusals at their route seams', async () => {
    const pacing = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      WORKER_NOW: () => 10_000,
      DB: {
        prepare() {
          return {
            bind() { return this },
            async first() { return { id: 'thread-123', message_count: 2, last_message_at: 9_500 } },
            async all() { return { results: [] } },
          }
        },
      },
    })
    const pacingResponse = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST', body: JSON.stringify(validChatBody()),
    }), pacing.env, {})
    expect(pacingResponse.status).toBe(429)
    expect(pacing.logs).toContainEqual(expect.objectContaining({
      stage: 'admission', outcomeCode: 'RATE_LIMITED',
    }))

    const conflict = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      WORKER_NOW: () => 20_000,
      DB: {
        prepare() {
          return {
            bind() { return this },
            async first() { return null },
            async all() { return { results: [] } },
          }
        },
        async batch() { return [{ success: true }, { results: [] }] },
      },
    })
    const conflictResponse = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST', body: JSON.stringify(validChatBody()),
    }), conflict.env, {})
    expect(conflictResponse.status).toBe(409)
    expect(conflict.logs).toContainEqual(expect.objectContaining({
      stage: 'reservation', outcomeCode: 'RESERVATION_CONFLICT', durationMs: 0,
    }))
  })

  it('keeps the operation header on a successful streaming response', async () => {
    async function* stream() {
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Hello' }
      yield { type: 'RUN_FINISHED', threadId: 'thread-123', runId: 'server-run' }
    }
    const { env } = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      CHAT_EVALUATION_TOKEN: 'server-evaluation-secret',
      DB: successfulChatDb(),
      WORKER_CHAT: () => stream(),
    })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: { 'x-chat-evaluation-token': 'server-evaluation-secret' },
      body: JSON.stringify(validChatBody()),
    }), env, {})

    expect(response.status).toBe(200)
    expect(response.headers.get('x-operation-id')).toMatch(/^op_[a-f0-9]{32}$/)
    expect(response.headers.get('x-run-kind')).toBe('synthetic')
    const payload = await response.text()
    expect(payload).toContain('Hello')
    expect(payload).toContain('RUN_FINISHED')
    expect(payload).not.toContain('server-evaluation-secret')
  })

  it('records visitor stream cancellation without escalating a server issue', async () => {
    async function* stream(signal) {
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Partial' }
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    }
    const { env, logs, issues } = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      DB: successfulChatDb(),
      WORKER_CHAT: ({ abortController }) => stream(abortController.signal),
    })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST', body: JSON.stringify(validChatBody()),
    }), env, {})
    const reader = response.body.getReader()

    await reader.read()
    await reader.cancel()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(logs).toContainEqual(expect.objectContaining({
      event: 'assistant.operation', outcomeCode: 'STREAM_CANCELLED', statusClass: '2xx',
    }))
    expect(issues).not.toContainEqual(expect.objectContaining({ outcomeCode: 'STREAM_CANCELLED' }))
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'forged-evaluation-token'],
  ])('ignores public synthetic classification when the evaluation token is %s', async (_name, token) => {
    const { env, logs, issues } = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      CHAT_EVALUATION_TOKEN: 'server-evaluation-secret',
    })
    const headers = token ? { 'x-chat-evaluation-token': token } : {}
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'evaluation', runKind: 'synthetic' }),
    }), env, {})

    expect(response.status).toBe(400)
    expect(response.headers.get('x-run-kind')).toBeNull()
    expect(JSON.stringify([...logs, ...issues])).not.toContain(token ?? 'server-evaluation-secret')
  })

  it('classifies a matching arbitrary D1 error message as persistence failure', async () => {
    async function* stream() {
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Hello' }
      yield { type: 'RUN_FINISHED', threadId: 'thread-123', runId: 'server-run' }
    }
    const { env, issues } = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      DB: successfulChatDb({ persistenceError: new Error('reservation was superseded in a driver message') }),
      WORKER_CHAT: () => stream(),
    })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST', body: JSON.stringify(validChatBody()),
    }), env, {})
    const payload = await response.text()
    expect(issues).toContainEqual(expect.objectContaining({ outcomeCode: 'PERSISTENCE_FAILED' }))
    expect(issues).not.toContainEqual(expect.objectContaining({ outcomeCode: 'RESERVATION_SUPERSEDED' }))
    expect(payload).toContain('PERSISTENCE_FAILED')
    expect(payload).not.toContain('reservation was superseded in a driver message')
  })

  it('replaces a thrown source error before the SSE response encodes it', async () => {
    async function* stream() {
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Partial' }
      throw new Error('private-provider-transport-sentinel')
    }
    const { env, issues } = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      DB: successfulChatDb(),
      WORKER_CHAT: () => stream(),
    })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST', body: JSON.stringify(validChatBody()),
    }), env, {})
    const payload = await response.text()

    expect(payload).toContain('SOURCE_FAILED')
    expect(payload).not.toContain('private-provider-transport-sentinel')
    expect(issues).toContainEqual(expect.objectContaining({ outcomeCode: 'SOURCE_FAILED' }))
  })
})

describe('Worker stream finalization', () => {
  it('records model pull, first content, persistence, terminal emission, and durable success in order', async () => {
    const order = []
    async function* source() {
      order.push('source-pulled')
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: '' }
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'Complete' }
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: ' answer' }
      yield { type: 'RUN_FINISHED' }
    }
    const events = finalizeAssistantStream(source(), {
      onFinished: async (text) => order.push(`persist:${text}`),
      onFailed: async () => order.push('release'),
      onLifecycle: ({ stage, outcomeCode }) => order.push(`${stage}:${outcomeCode}`),
    })

    expect(order).toEqual([])
    for await (const event of events) {
      if (event.type === 'RUN_FINISHED') order.push('consumer-terminal')
    }

    expect(order).toEqual([
      'model_start:MODEL_STARTED',
      'source-pulled',
      'first_content:CONTENT_STARTED',
      'stream:STREAM_COMPLETED',
      'persist:Complete answer',
      'persistence:PERSISTENCE_COMMITTED',
      'consumer-terminal',
      'terminal:TERMINAL_EMITTED',
      'terminal:SERVER_DURABLE_SUCCESS',
    ])
  })

  it('uses one injected start point for first-content, completion, persistence, and durable durations', async () => {
    const lifecycle = []
    const times = [1_100, 1_200, 1_300, 1_400]
    async function* source() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'answer' }
      yield { type: 'RUN_FINISHED' }
    }

    for await (const _event of finalizeAssistantStream(source(), {
      startedAt: 1_000,
      now: () => times.shift(),
      onFinished: async () => {},
      onFailed: async () => {},
      onLifecycle: (event) => lifecycle.push(event),
    })) {}

    expect(lifecycle).toContainEqual({ stage: 'first_content', outcomeCode: 'CONTENT_STARTED', durationMs: 100 })
    expect(lifecycle).toContainEqual({ stage: 'stream', outcomeCode: 'STREAM_COMPLETED', durationMs: 200 })
    expect(lifecycle).toContainEqual({ stage: 'persistence', outcomeCode: 'PERSISTENCE_COMMITTED', durationMs: 300 })
    expect(lifecycle).toContainEqual({ stage: 'terminal', outcomeCode: 'SERVER_DURABLE_SUCCESS', durationMs: 400 })
  })

  it('fails open when lifecycle observation throws on success and failure', async () => {
    const successOrder = []
    async function* successfulSource() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'answer' }
      yield { type: 'RUN_FINISHED' }
    }
    for await (const event of finalizeAssistantStream(successfulSource(), {
      onFinished: async () => successOrder.push('persist'),
      onFailed: async () => successOrder.push('release'),
      onLifecycle: () => { throw new Error('observer failed') },
    })) {
      if (event.type === 'RUN_FINISHED') successOrder.push('terminal')
    }
    expect(successOrder).toEqual(['persist', 'terminal'])

    const failureOrder = []
    async function* failedSource() { yield { type: 'RUN_ERROR', message: 'provider failed' } }
    for await (const _event of finalizeAssistantStream(failedSource(), {
      onFinished: async () => failureOrder.push('persist'),
      onFailed: async () => failureOrder.push('release'),
      onLifecycle: () => { throw new Error('observer failed') },
    })) {}
    expect(failureOrder).toEqual(['release'])
  })

  it('persists before exposing the terminal success event', async () => {
    const order = []
    async function* source() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'Complete answer' }
      yield { type: 'RUN_FINISHED' }
    }
    const events = []

    for await (const event of finalizeAssistantStream(source(), {
      onFinished: async (text) => order.push(`persist:${text}`),
      onFailed: async () => order.push('release'),
    })) {
      events.push(event)
      if (event.type === 'RUN_FINISHED') order.push('terminal')
    }

    expect(order).toEqual(['persist:Complete answer', 'terminal'])
    expect(events).toHaveLength(2)
  })

  it('releases failed partial output without persisting it', async () => {
    const calls = []
    async function* source() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'Partial answer' }
      yield {
        type: 'RUN_ERROR',
        message: 'provider details private-provider-sentinel',
        code: 'request_id_private-provider-sentinel',
        requestId: 'private-provider-sentinel',
        rawEvent: { headers: { authorization: 'private-provider-sentinel' } },
      }
    }

    const events = []
    for await (const event of finalizeAssistantStream(source(), {
      onFinished: async () => calls.push('persist'),
      onFailed: async () => calls.push('release'),
    })) events.push(event)

    expect(calls).toEqual(['release'])
    expect(events.at(-1)).toEqual({
      type: 'RUN_ERROR',
      code: 'MODEL_FAILED',
      message: 'The assistant could not answer that just now. Please try again.',
    })
    expect(JSON.stringify(events)).not.toContain('private-provider-sentinel')
  })

  it.each([
    {
      name: 'empty completion',
      source: async function* () { yield { type: 'RUN_FINISHED' } },
      reason: 'empty_completion',
      outcomeCode: 'EMPTY_COMPLETION',
    },
    {
      name: 'normal source exhaustion',
      source: async function* () { yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial' } },
      reason: 'source_exhausted',
      outcomeCode: 'SOURCE_EXHAUSTED',
    },
    {
      name: 'source throw',
      source: async function* () { throw new Error('provider transport failed') },
      reason: 'source_failed',
      outcomeCode: 'SOURCE_FAILED',
    },
  ])('keeps $name distinct and releases ownership', async ({ source, reason, outcomeCode }) => {
    const releases = []
    const lifecycle = []
    const consume = async () => {
      for await (const _event of finalizeAssistantStream(source(), {
        onFinished: async () => {},
        onFailed: async (failure) => releases.push(failure),
        onLifecycle: (event) => lifecycle.push(event),
      })) {}
    }

    await consume()

    expect(releases).toEqual([reason])
    expect(lifecycle).toContainEqual({ stage: 'stream', outcomeCode })
  })

  it('distinguishes cancellation and persistence failure without double release', async () => {
    const cancellationReleases = []
    async function* endlessSource() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial' }
      await new Promise(() => {})
    }
    const cancelled = finalizeAssistantStream(endlessSource(), {
      onFinished: async () => {},
      onFailed: async (failure) => cancellationReleases.push(failure),
    })
    await cancelled.next()
    await cancelled.return()
    expect(cancellationReleases).toEqual(['stream_cancelled'])

    const persistenceReleases = []
    async function* completeSource() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'answer' }
      yield { type: 'RUN_FINISHED' }
    }
    const events = []
    const consume = async () => {
      for await (const event of finalizeAssistantStream(completeSource(), {
        onFinished: async () => { throw new Error('D1 failed') },
        onFailed: async (failure) => persistenceReleases.push(failure),
      })) events.push(event)
    }
    await consume()
    expect(persistenceReleases).toEqual(['persistence_failed'])
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'RUN_ERROR', code: 'PERSISTENCE_FAILED' }))
    expect(JSON.stringify(events)).not.toContain('D1 failed')
  })

  it('records durable success when the consumer stops after receiving the terminal event', async () => {
    const lifecycle = []
    async function* source() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'answer' }
      yield { type: 'RUN_FINISHED' }
    }
    const events = finalizeAssistantStream(source(), {
      onFinished: async () => {},
      onFailed: async () => {},
      onLifecycle: (event) => lifecycle.push(event),
    })

    await events.next()
    expect((await events.next()).value).toEqual({ type: 'RUN_FINISHED' })
    await events.return()

    expect(lifecycle).toContainEqual(expect.objectContaining({ outcomeCode: 'TERMINAL_EMITTED' }))
    expect(lifecycle).toContainEqual(expect.objectContaining({ outcomeCode: 'SERVER_DURABLE_SUCCESS' }))
  })
})

describe('Worker transcript replay', () => {
  it('keeps a durable memory while returning only the newest verbatim window', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 40, 40)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 40; index += 1) {
      insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    }
    sqlite.query('INSERT INTO conversation_memories (conversation_id, content, summarized_through_id, summarized_message_count, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('thread-123', 'The reader is discussing Dashy evaluation.', 10, 10, 50)

    await expect(loadConversationContext(d1, 'thread-123')).resolves.toMatchObject({
      memory: {
        content: 'The reader is discussing Dashy evaluation.',
        messageCount: 10,
        updatedAt: 50,
      },
      hasEarlierMessages: true,
      messages: expect.arrayContaining([
        expect.objectContaining({ content: 'Message 11' }),
        expect.objectContaining({ content: 'Message 40' }),
      ]),
    })
    const context = await loadConversationContext(d1, 'thread-123')
    expect(context.messages).toHaveLength(30)
    expect(context.messages[0].content).toBe('Message 11')
    sqlite.close()
  })

  it('rolls newly displaced messages into the existing memory', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 34, 34)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 34; index += 1) {
      insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    }
    sqlite.query('INSERT INTO conversation_memories (conversation_id, content, summarized_through_id, summarized_message_count, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('thread-123', 'Existing memory.', 2, 2, 2)
    const inputs = []

    const context = await loadConversationContext(d1, 'thread-123')
    const memory = await refreshConversationMemory(d1, 'thread-123', context, {
      now: () => 100,
      summarize: async (input) => {
        inputs.push(input)
        return 'Updated memory.'
      },
    })

    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain('Existing memory.')
    expect(inputs[0]).toContain('User: Message 3')
    expect(inputs[0]).toContain('Assistant: Message 4')
    expect(memory).toEqual({
      memory: { content: 'Updated memory.', messageCount: 4, updatedAt: 100 },
      complete: true,
    })
    expect(sqlite.query('SELECT content, summarized_through_id, summarized_message_count FROM conversation_memories WHERE conversation_id = ?').get('thread-123')).toEqual({
      content: 'Updated memory.',
      summarized_through_id: 4,
      summarized_message_count: 4,
    })
    sqlite.close()
  })

  it('bounds each memory refresh and reports an incomplete backlog', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 100, 100)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 100; index += 1) {
      insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    }
    const inputs = []

    const result = await refreshConversationMemory(d1, 'thread-123', await loadConversationContext(d1, 'thread-123'), {
      summarize: async (input) => {
        inputs.push(input)
        return 'Partial memory.'
      },
    })

    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain('Message 30')
    expect(inputs[0]).not.toContain('Message 31')
    expect(result.complete).toBe(false)
    expect(sqlite.query('SELECT summarized_through_id FROM conversation_memories WHERE conversation_id = ?').get('thread-123'))
      .toEqual({ summarized_through_id: 30 })
    sqlite.close()
  })

  it('never lets an older refresh regress durable memory', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 34, 34)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 34; index += 1) insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    const staleContext = await loadConversationContext(d1, 'thread-123')
    await refreshConversationMemory(d1, 'thread-123', staleContext, { summarize: async () => 'Newer memory.' })
    const staleResult = await refreshConversationMemory(d1, 'thread-123', staleContext, { summarize: async () => 'Stale memory.' })

    expect(staleResult.memory.content).toBe('Newer memory.')
    expect(sqlite.query('SELECT content, summarized_through_id FROM conversation_memories WHERE conversation_id = ?').get('thread-123'))
      .toEqual({ content: 'Newer memory.', summarized_through_id: 4 })
    sqlite.close()
  })

  it('adds a compound index for history cursors', () => {
    const { sqlite } = migratedSqliteD1()
    const indexes = sqlite.query("PRAGMA index_list('messages')").all().map((row) => row.name)
    expect(indexes).toContain('idx_messages_conversation_id')
    sqlite.close()
  })

  it('pages earlier stored messages without changing model context', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 36, 36)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 36; index += 1) {
      insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    }

    await expect(loadEarlierMessages(d1, 'thread-123', { beforeId: 7, limit: 4 })).resolves.toEqual({
      messages: [
        { id: 3, role: 'user', content: 'Message 3', created_at: 3 },
        { id: 4, role: 'assistant', content: 'Message 4', created_at: 4 },
        { id: 5, role: 'user', content: 'Message 5', created_at: 5 },
        { id: 6, role: 'assistant', content: 'Message 6', created_at: 6 },
      ],
      nextBeforeId: 3,
    })
    sqlite.close()
  })

  it('serves read-only earlier history through the possession credential', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 6, 6)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 6; index += 1) {
      insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    }

    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/history?before=5', {
      headers: { 'x-chat-thread-id': 'thread-123' },
    }), { DB: d1 }, {})

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      messages: [
        { id: 1, role: 'user', content: 'Message 1', created_at: 1 },
        { id: 2, role: 'assistant', content: 'Message 2', created_at: 2 },
        { id: 3, role: 'user', content: 'Message 3', created_at: 3 },
        { id: 4, role: 'assistant', content: 'Message 4', created_at: 4 },
      ],
      nextBeforeId: null,
    })
    sqlite.close()
  })

  it('refreshes stale memory before replaying an over-window conversation', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 32, 32)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 32; index += 1) {
      insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    }

    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: { 'x-chat-thread-id': 'thread-123' },
    }), {
      DB: d1,
      WORKER_NOW: () => 50,
      WORKER_SUMMARIZE: async () => ({ summary: 'The opening turn established the reader’s topic.' }),
    }, {})

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      memory: {
        content: 'The opening turn established the reader’s topic.',
        messageCount: 2,
        updatedAt: 50,
      },
      hasEarlierMessages: true,
      memoryUnavailable: false,
    })
    sqlite.close()
  })

  it('discloses a replay memory failure while keeping recent messages available', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query('INSERT INTO conversations (id, created_at, last_message_at, message_count) VALUES (?, ?, ?, ?)')
      .run('thread-123', 1, 32, 32)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 32; index += 1) insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Message ${index}`, index)
    const observed = observedEnv({
      DB: d1,
      WORKER_SUMMARIZE: async () => { throw new Error('summary failed') },
    })

    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: { 'x-chat-thread-id': 'thread-123' },
    }), observed.env, {})
    const transcript = await response.json()

    expect(response.status).toBe(200)
    expect(transcript.memoryUnavailable).toBe(true)
    expect(transcript.messages).toHaveLength(30)
    expect(observed.issues).toContainEqual(expect.objectContaining({ outcomeCode: 'MEMORY_REFRESH_FAILED' }))
    sqlite.close()
  })

  it('rate-limits transcript reads before accessing D1', async () => {
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: {
        'cf-connecting-ip': '203.0.113.10',
        'x-chat-thread-id': 'thread-123',
      },
    }), {
      CHAT_RATE_LIMITER: { limit: async () => ({ success: false }) },
      DB: { prepare: () => { throw new Error('D1 should not be read') } },
    }, {})

    expect(response.status).toBe(429)
  })

  it('returns the newest history window in chronological order', async () => {
    const prepared = []
    const db = {
      prepare(sql) {
        const statement = {
          binds: [],
          sql: sql.replace(/\s+/g, ' ').trim(),
          bind(...values) {
            this.binds = values
            return this
          },
          async all() {
            return {
              results: [
                { role: 'assistant', content: 'Newest', created_at: 4 },
                { role: 'user', content: 'Older', created_at: 3 },
              ],
            }
          },
          async first() { return null },
        }
        prepared.push(statement)
        return statement
      },
    }

    await expect(loadConversationContext(db, 'thread-123')).resolves.toMatchObject({
      memory: null,
      hasEarlierMessages: false,
      messages: [
        { role: 'user', content: 'Older', created_at: 3 },
        { role: 'assistant', content: 'Newest', created_at: 4 },
      ],
    })
    expect(prepared[0].sql).toContain('ORDER BY created_at DESC, id DESC LIMIT ?')
    expect(prepared[0].binds).toEqual(['thread-123', 31])
  })

  it('prevents stored conversations from being cached', async () => {
    const db = {
      prepare() {
        return {
          bind() { return this },
          async all() { return { results: [] } },
          async first() { return null },
        }
      },
    }

    const response = await worker.fetch(
      new Request('https://kwamina.fyi/api/chat/transcript', {
        headers: { 'x-chat-thread-id': 'thread-123' },
      }),
      { DB: db },
      {},
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it.each([
    ['empty', [], 'REPLAY_EMPTY'],
    ['nonempty', [{ role: 'assistant', content: 'Stored answer', created_at: 4 }], 'REPLAY_NONEMPTY'],
  ])('records %s D1 replay and returns a distinct operation ID', async (_name, rows, outcomeCode) => {
    const { env, logs } = observedEnv({
      DB: {
        prepare() {
          return {
            bind() { return this },
            async all() { return { results: [...rows].reverse() } },
            async first() { return null },
          }
        },
      },
    })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: { 'x-chat-thread-id': 'thread-123' },
    }), env, {})

    expect(response.status).toBe(200)
    expect(response.headers.get('x-operation-id')).toMatch(/^op_[a-f0-9]{32}$/)
    expect(logs.map(({ outcomeCode: code }) => code)).toEqual(['REPLAY_STARTED', outcomeCode])
  })

  it('acknowledges and classifies token-authorized synthetic replay', async () => {
    const { env, logs } = observedEnv({
      CHAT_EVALUATION_TOKEN: 'server-evaluation-secret',
      DB: {
        prepare() {
          return { bind() { return this }, async all() { return { results: [] } }, async first() { return null } }
        },
      },
    })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: {
        'x-chat-evaluation-token': 'server-evaluation-secret',
        'x-chat-thread-id': 'thread-123',
      },
    }), env, {})

    expect(response.headers.get('x-run-kind')).toBe('synthetic')
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'evaluation', runKind: 'synthetic' }),
    ]))
    expect(JSON.stringify(logs)).not.toContain('server-evaluation-secret')
  })

  it('captures D1 replay failures without leaking the thrown message', async () => {
    const { env, issues } = observedEnv({
      DB: { prepare: () => { throw new Error('private transcript payload') } },
    })
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: { 'x-chat-thread-id': 'thread-123' },
    }), env, {})

    expect(response.status).toBe(500)
    expect(response.headers.get('x-operation-id')).toMatch(/^op_[a-f0-9]{32}$/)
    expect(issues).toContainEqual(expect.objectContaining({ outcomeCode: 'REPLAY_FAILED' }))
    expect(JSON.stringify(issues)).not.toContain('private transcript payload')
  })
})

describe('Local conversation inspector', () => {
  it('is available only on local hostnames', () => {
    expect(isLocalConversationInspector('http://localhost:8787/api/conversations')).toBe(true)
    expect(isLocalConversationInspector('http://127.0.0.1:8787/api/conversations')).toBe(true)
    expect(isLocalConversationInspector('https://kwamina.fyi/api/conversations')).toBe(false)
  })

  it('lists recent conversations and returns bounded transcript metadata', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query(`
      INSERT INTO conversations (
        id, created_at, last_message_at, message_count, source, environment
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('thread-local-123', 100, 200, 2, 'site', 'local')
    sqlite.query(`
      INSERT INTO messages (conversation_id, role, content, created_at, page_path)
      VALUES (?, 'user', ?, ?, ?)
    `).run('thread-local-123', 'How does this work?', 100, '/work/athena')
    sqlite.query(`
      INSERT INTO messages (
        conversation_id, role, content, created_at,
        assistant_version, corpus_version, model, latency_ms
      ) VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)
    `).run('thread-local-123', 'Like this.', 101, '2026-08-11.2', 'abc123def456', 'model-1', 240)

    await expect(listConversationInspector(d1)).resolves.toEqual([
      expect.objectContaining({
        id: 'thread-local-123',
        first_question: 'How does this work?',
        message_count: 2,
      }),
    ])
    await expect(loadConversationInspector(d1, 'thread-local-123')).resolves.toEqual({
      conversation: expect.objectContaining({ id: 'thread-local-123', environment: 'local' }),
      messages: [
        expect.objectContaining({ role: 'user', page_path: '/work/athena' }),
        expect.objectContaining({
          role: 'assistant',
          assistant_version: '2026-08-11.2',
          corpus_version: 'abc123def456',
          latency_ms: 240,
        }),
      ],
    })
  })

  it('returns 404 before touching D1 outside local development', async () => {
    const response = await worker.fetch(
      new Request('https://kwamina.fyi/api/conversations'),
      { DB: { prepare: () => { throw new Error('D1 should not be read') } } },
      {},
    )

    expect(response.status).toBe(404)
  })

  it('serves the local list without caching it', async () => {
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/conversations'),
      {
        DB: {
          prepare() {
            return {
              bind() { return this },
              async all() { return { results: [] } },
            }
          },
        },
      },
      {},
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ conversations: [] })
  })

  it('fails closed on production unless the admin host, feature flag, and Access identity agree', async () => {
    const request = new Request('https://admin.kwamina.fyi/api/conversations', {
      headers: { 'cf-access-jwt-assertion': 'signed-access-token' },
    })
    const configured = {
      CONVERSATION_ARCHIVE_ENABLED: 'true',
      CONVERSATION_ARCHIVE_HOSTNAME: 'admin.kwamina.fyi',
      CF_ACCESS_TEAM_DOMAIN: 'https://kwamina.cloudflareaccess.com',
      CF_ACCESS_AUD: 'archive-audience',
      CF_ACCESS_ALLOWED_EMAIL: 'owner@example.com',
    }

    let verification
    await expect(conversationInspectorAccess(request, configured, async (token, options) => {
      verification = { token, options }
      return { email: 'owner@example.com' }
    })).resolves.toEqual({ allowed: true, productionOnly: true })
    expect(verification).toEqual({
      token: 'signed-access-token',
      options: {
        teamDomain: 'https://kwamina.cloudflareaccess.com',
        audience: 'archive-audience',
      },
    })
    await expect(conversationInspectorAccess(request, {
      ...configured,
      CONVERSATION_ARCHIVE_ENABLED: 'false',
    }, async () => ({ email: 'owner@example.com' }))).resolves.toEqual({
      allowed: false,
      productionOnly: true,
    })
    await expect(conversationInspectorAccess(request, configured, async () => ({
      email: 'someone-else@example.com',
    }))).resolves.toEqual({ allowed: false, productionOnly: true })
    await expect(conversationInspectorAccess(
      new Request('https://kwamina.fyi/api/conversations', {
        headers: { 'cf-access-jwt-assertion': 'signed-access-token' },
      }),
      configured,
      async () => { throw new Error('the public hostname must not verify a token') },
    )).resolves.toEqual({ allowed: false, productionOnly: true })
  })

  it('returns 404 before D1 when Access authentication is missing or invalid', async () => {
    const makeEnv = () => ({
      CONVERSATION_ARCHIVE_ENABLED: 'true',
      CONVERSATION_ARCHIVE_HOSTNAME: 'admin.kwamina.fyi',
      CF_ACCESS_TEAM_DOMAIN: 'https://kwamina.cloudflareaccess.com',
      CF_ACCESS_AUD: 'archive-audience',
      CF_ACCESS_ALLOWED_EMAIL: 'owner@example.com',
      DB: { prepare: () => { throw new Error('D1 should not be read') } },
    })

    const acceptingWorker = createWorker({
      verifyAccessToken: async () => ({ email: 'owner@example.com' }),
    })
    const rejectingWorker = createWorker({
      verifyAccessToken: async () => { throw new Error('invalid signature') },
    })
    const missing = await acceptingWorker.fetch(
      new Request('https://admin.kwamina.fyi/api/conversations'),
      makeEnv(),
      {},
    )
    const invalid = await rejectingWorker.fetch(
      new Request('https://admin.kwamina.fyi/api/conversations', {
        headers: { 'cf-access-jwt-assertion': 'invalid-token' },
      }),
      makeEnv(),
      {},
    )

    expect(missing.status).toBe(404)
    expect(invalid.status).toBe(404)
  })

  it('shows only production site conversations through the protected hostname', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    for (const row of [
      ['thread-prod-123', 'site', 'production', 'Production question'],
      ['thread-eval-123', 'evaluation', 'production', 'Evaluation question'],
      ['thread-local-123', 'site', 'local', 'Local question'],
    ]) {
      sqlite.query(`
        INSERT INTO conversations (
          id, created_at, last_message_at, message_count, source, environment
        ) VALUES (?, 100, 100, 1, ?, ?)
      `).run(row[0], row[1], row[2])
      sqlite.query(`
        INSERT INTO messages (conversation_id, role, content, created_at)
        VALUES (?, 'user', ?, 100)
      `).run(row[0], row[3])
    }

    const archiveWorker = createWorker({
      verifyAccessToken: async () => ({ email: 'owner@example.com' }),
    })
    const response = await archiveWorker.fetch(
      new Request('https://admin.kwamina.fyi/api/conversations', {
        headers: { 'cf-access-jwt-assertion': 'signed-access-token' },
      }),
      {
        CONVERSATION_ARCHIVE_ENABLED: 'true',
        CONVERSATION_ARCHIVE_HOSTNAME: 'admin.kwamina.fyi',
        CF_ACCESS_TEAM_DOMAIN: 'https://kwamina.cloudflareaccess.com',
        CF_ACCESS_AUD: 'archive-audience',
        CF_ACCESS_ALLOWED_EMAIL: 'owner@example.com',
        DB: d1,
      },
      {},
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      conversations: [expect.objectContaining({ id: 'thread-prod-123' })],
    })
    await expect(loadConversationInspector(d1, 'thread-eval-123', {
      productionOnly: true,
    })).resolves.toBeNull()
    await expect(loadConversationInspector(d1, 'thread-local-123', {
      productionOnly: true,
    })).resolves.toBeNull()

    for (const id of ['thread-eval-123', 'thread-local-123']) {
      const detailResponse = await archiveWorker.fetch(
        new Request(`https://admin.kwamina.fyi/api/conversations/${id}`, {
          headers: { 'cf-access-jwt-assertion': 'signed-access-token' },
        }),
        {
          CONVERSATION_ARCHIVE_ENABLED: 'true',
          CONVERSATION_ARCHIVE_HOSTNAME: 'admin.kwamina.fyi',
          CF_ACCESS_TEAM_DOMAIN: 'https://kwamina.cloudflareaccess.com',
          CF_ACCESS_AUD: 'archive-audience',
          CF_ACCESS_ALLOWED_EMAIL: 'owner@example.com',
          DB: d1,
        },
        {},
      )
      expect(detailResponse.status).toBe(404)
    }
  })

  it('authorizes the private page before serving the SPA asset', async () => {
    let assetReads = 0
    const archiveWorker = createWorker({
      verifyAccessToken: async () => ({ email: 'owner@example.com' }),
    })
    const configured = {
      CONVERSATION_ARCHIVE_ENABLED: 'true',
      CONVERSATION_ARCHIVE_HOSTNAME: 'admin.kwamina.fyi',
      CF_ACCESS_TEAM_DOMAIN: 'https://kwamina.cloudflareaccess.com',
      CF_ACCESS_AUD: 'archive-audience',
      CF_ACCESS_ALLOWED_EMAIL: 'owner@example.com',
      ASSETS: {
        async fetch() {
          assetReads += 1
          return new Response('<main>Private archive</main>', {
            headers: {
              'content-type': 'text/html',
              'content-security-policy': "default-src 'self'; script-src 'self'",
              'x-content-type-options': 'nosniff',
            },
          })
        },
      },
    }

    const denied = await archiveWorker.fetch(
      new Request('https://admin.kwamina.fyi/conversations'),
      configured,
      {},
    )
    const allowed = await archiveWorker.fetch(
      new Request('https://admin.kwamina.fyi/conversations', {
        headers: { 'cf-access-jwt-assertion': 'signed-access-token' },
      }),
      configured,
      {},
    )

    expect(denied.status).toBe(404)
    expect(assetReads).toBe(1)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('x-content-type-options')).toBe('nosniff')
    expect(allowed.headers.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'self'",
    )
  })
})

describe('Worker infrastructure failure privacy', () => {
  const SENTINEL = 'private-infrastructure-sentinel'

  it('sanitizes rate-limit binding and D1 failures through the observer', async () => {
    const binding = observedEnv({
      CHAT_RATE_LIMITER: { limit: async () => { throw new Error(SENTINEL) } },
    })
    await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.10' },
      body: JSON.stringify(validChatBody()),
    }), binding.env, {})
    expect(binding.issues).toContainEqual(expect.objectContaining({
      outcomeCode: 'RATE_LIMIT_BINDING_FAILED',
    }))
    expect(JSON.stringify(binding.issues)).not.toContain(SENTINEL)

    const d1 = observedEnv({
      RATE_LIMIT_KEY: 'server-secret',
      DB: { prepare: () => { throw new Error(SENTINEL) } },
    })
    await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.10' },
      body: JSON.stringify(validChatBody()),
    }), d1.env, {})
    expect(d1.issues).toContainEqual(expect.objectContaining({
      outcomeCode: 'RATE_LIMIT_D1_FAILED',
    }))
    expect(JSON.stringify(d1.issues)).not.toContain(SENTINEL)
  })

  it('sanitizes scheduled sweep failures through the observer', async () => {
    const { env, issues } = observedEnv({
      DB: { prepare: () => { throw new Error(SENTINEL) } },
    })
    await worker.scheduled({}, env, {})

    expect(issues).toContainEqual(expect.objectContaining({
      event: 'worker.issue',
      outcomeCode: 'RATE_LIMIT_SWEEP_FAILED',
    }))
    expect(JSON.stringify(issues)).not.toContain(SENTINEL)
  })
})

describe('Removed viewport diagnostics', () => {
  it('does not expose the temporary endpoint or retain its D1 table', async () => {
    const { sqlite } = migratedSqliteD1()
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat/diagnostics', {
      method: 'POST',
    }), {}, {})

    expect(response.status).toBe(404)
    expect(sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'viewport_diagnostics'").get()).toBeNull()
    sqlite.close()
  })
})

describe('Worker conversation admission', () => {
  it('keeps long-running conversations open while preserving the pacing limit', () => {
    const longConversation = { message_count: 10_000, last_message_at: 1_000 }

    expect(rejectionFor(longConversation, 10_000)).toBeNull()
    expect(rejectionFor(longConversation, 2_000)).toEqual({
      status: 429,
      error: 'One moment — that was a little fast. Try again in a second.',
    })
  })

  it('accepts a long client transcript and sends durable memory plus recent messages to the model', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query(`
      INSERT INTO conversations (
        id, created_at, last_message_at, message_count,
        turn_status, turn_started_at, turn_token
      ) VALUES (?, ?, ?, ?, 'idle', NULL, NULL)
    `).run('thread-123', 1, 1, 34)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 34; index += 1) {
      insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Stored ${index}`, index)
    }
    let modelInput
    async function* stream() {
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Answer' }
      yield { type: 'RUN_FINISHED', threadId: 'thread-123', runId: 'server-run' }
    }

    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      body: JSON.stringify(validChatBody({
        messages: Array.from({ length: 41 }, (_, index) => ({
          id: `client-${index}`,
          role: index % 2 ? 'assistant' : 'user',
          content: index === 40 ? 'Newest question' : `Client ${index}`,
        })),
      })),
    }), {
      ANTHROPIC_API_KEY: 'configured',
      DB: d1,
      WORKER_NOW: () => 100_000,
      WORKER_SUMMARIZE: async ({ text }) => {
        expect(text).toContain('User: Stored 1')
        expect(text).toContain('Assistant: Stored 4')
        return { summary: 'The reader is discussing a long-running topic.' }
      },
      WORKER_CHAT: (input) => {
        modelInput = input.messages
        return stream()
      },
    }, {})
    await response.text()

    expect(response.status).toBe(200)
    expect(modelInput[0]).toEqual({
      role: 'user',
      content: '[Conversation memory — summary of earlier messages]\nThe reader is discussing a long-running topic.',
    })
    expect(modelInput).toHaveLength(32)
    expect(modelInput.at(-1).content).toBe('Newest question')
    sqlite.close()
  })

  it('fails open when chat memory refresh fails', async () => {
    const { sqlite, d1 } = migratedSqliteD1()
    sqlite.query(`
      INSERT INTO conversations (
        id, created_at, last_message_at, message_count,
        turn_status, turn_started_at, turn_token
      ) VALUES (?, ?, ?, ?, 'idle', NULL, NULL)
    `).run('thread-123', 1, 1, 32)
    const insert = sqlite.query('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 1; index <= 32; index += 1) insert.run('thread-123', index % 2 ? 'user' : 'assistant', `Stored ${index}`, index)
    let modelInput
    async function* stream() {
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Answer' }
      yield { type: 'RUN_FINISHED', threadId: 'thread-123', runId: 'server-run' }
    }
    const observed = observedEnv({
      ANTHROPIC_API_KEY: 'configured',
      DB: d1,
      WORKER_NOW: () => 100_000,
      WORKER_SUMMARIZE: async () => { throw new Error('summary failed') },
      WORKER_CHAT: (input) => {
        modelInput = input.messages
        return stream()
      },
    })

    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      body: JSON.stringify(validChatBody({ messages: [{ id: 'new', role: 'user', content: 'Newest question' }] })),
    }), observed.env, {})
    await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-chat-memory-status')).toBe('unavailable')
    expect(modelInput).toHaveLength(31)
    expect(modelInput[0].content).toBe('Stored 3')
    expect(modelInput.at(-1).content).toBe('Newest question')
    expect(observed.issues).toContainEqual(expect.objectContaining({ outcomeCode: 'MEMORY_REFRESH_FAILED' }))
    expect(sqlite.query('SELECT message_count, turn_status FROM conversations WHERE id = ?').get('thread-123'))
      .toEqual({ message_count: 34, turn_status: 'idle' })
    sqlite.close()
  })
})

describe('Worker response headers', () => {
  // dist/_headers covers asset responses only, so anything the Worker returns
  // has to carry these itself.
  it('hardens every response the Worker builds, including error paths', async () => {
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/nothing'), {}, {})

    expect(response.status).toBe(404)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('adds the headers without disturbing the response it is given', () => {
    const response = secured(new Response('body', {
      status: 418,
      headers: { 'content-type': 'text/plain', 'cache-control': 'private, no-store' },
    }))

    expect(response.status).toBe(418)
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
