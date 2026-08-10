import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import worker, {
  attachConversationCapability,
  callerKey,
  conversationCapabilityCookie,
  conversationCapabilityFor,
  finalizeAssistantStream,
  hasConversationCapability,
  handleChat,
  loadTranscript,
  persistTurn,
  readJsonBody,
  releaseTurn,
  rejectionFor,
  reserveTurn,
  resolvePage,
  withPageMarker,
} from './index.js'

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

function chatRequest(threadId, headers = {}) {
  return new Request('https://kwamina.fyi/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      threadId,
      runId: crypto.randomUUID(),
      messages: [{ id: crypto.randomUUID(), role: 'user', content: 'Tell me about Athena.' }],
      tools: [],
      context: [],
      state: {},
    }),
  })
}

async function* completedAssistantStream() {
  yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'Athena is a business operating system.' }
  yield { type: 'RUN_FINISHED' }
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
})

describe('Worker conversation capabilities', () => {
  it('fails before touching conversation state when the capability key is missing', async () => {
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'thread-123',
        runId: 'run-123',
        messages: [{ id: 'message-123', role: 'user', content: 'Tell me about Athena.' }],
        tools: [],
        context: [],
        state: {},
      }),
    }), {
      ANTHROPIC_API_KEY: 'unused',
      DB: { prepare: () => { throw new Error('D1 should not be read') } },
    }, {})

    expect(response.status).toBe(503)
  })

  it('issues an opaque capability in a host-only hardened cookie', async () => {
    const capability = await conversationCapabilityFor('thread-123', 'conversation-secret')
    const cookie = conversationCapabilityCookie('thread-123', capability)

    expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cookie).toBe(
      `__Host-chat-capability-thread-123=${capability}; Path=/; HttpOnly; Secure; SameSite=Strict`,
    )
    expect(capability).not.toContain('thread-123')
  })

  it('accepts only the capability signed for the requested conversation', async () => {
    const capability = await conversationCapabilityFor('thread-123', 'conversation-secret')
    const request = new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: { cookie: `other=value; __Host-chat-capability-thread-123=${capability}` },
    })

    await expect(hasConversationCapability(request, 'thread-123', 'conversation-secret')).resolves.toBe(true)
    await expect(hasConversationCapability(request, 'thread-456', 'conversation-secret')).resolves.toBe(false)
    await expect(hasConversationCapability(request, 'thread-123', 'different-secret')).resolves.toBe(false)

    const renamed = new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: { cookie: `__Host-chat-capability-thread-456=${capability}` },
    })
    await expect(hasConversationCapability(renamed, 'thread-456', 'conversation-secret')).resolves.toBe(false)
  })

  it('keeps capabilities for simultaneous conversations independent', async () => {
    const first = await conversationCapabilityFor('thread-123', 'conversation-secret')
    const second = await conversationCapabilityFor('thread-456', 'conversation-secret')
    const request = new Request('https://kwamina.fyi/api/chat/transcript', {
      headers: {
        cookie: [
          `__Host-chat-capability-thread-123=${first}`,
          `__Host-chat-capability-thread-456=${second}`,
        ].join('; '),
      },
    })

    await expect(hasConversationCapability(request, 'thread-123', 'conversation-secret')).resolves.toBe(true)
    await expect(hasConversationCapability(request, 'thread-456', 'conversation-secret')).resolves.toBe(true)
  })

  it('attaches the server-issued capability to a first-turn response', async () => {
    const response = await attachConversationCapability(
      new Response('stream'),
      'thread-123',
      'conversation-secret',
    )

    expect(response.headers.get('set-cookie')).toMatch(
      /^__Host-chat-capability-thread-123=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
    )
  })

  it('issues a capability on the first endpoint turn and accepts it on the next turn', async () => {
    const { d1, sqlite } = migratedSqliteD1()
    const env = {
      ANTHROPIC_API_KEY: 'unused',
      CHAT_CAPABILITY_KEY: 'conversation-secret',
      DB: d1,
    }
    const createStream = () => completedAssistantStream()

    const first = await handleChat(chatRequest('thread-123'), env, {}, createStream)
    const cookie = first.headers.get('set-cookie')
    expect(cookie).toMatch(/^__Host-chat-capability-thread-123=/)
    await first.text()

    sqlite.query('UPDATE conversations SET last_message_at = 0 WHERE id = ?').run('thread-123')
    const second = await handleChat(chatRequest('thread-123', {
      cookie: cookie.split(';', 1)[0],
    }), env, {}, createStream)
    expect(second.status).toBe(200)
    expect(second.headers.get('set-cookie')).toBeNull()
    await second.text()
    expect(sqlite.query('SELECT count(*) AS count FROM messages WHERE conversation_id = ?').get('thread-123').count).toBe(4)
    sqlite.close()
  })

  it('rejects a turn against an existing conversation without its capability', async () => {
    const db = {
      prepare() {
        return {
          bind() { return this },
          async first() {
            return { id: 'thread-123', message_count: 2, last_message_at: 0 }
          },
          async all() { throw new Error('History should not be read before authorization') },
        }
      },
    }
    const response = await worker.fetch(new Request('https://kwamina.fyi/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'thread-123',
        runId: 'run-123',
        messages: [{ id: 'message-123', role: 'user', content: 'Tell me about Athena.' }],
        tools: [],
        context: [],
        state: {},
      }),
    }), {
      ANTHROPIC_API_KEY: 'unused',
      DB: db,
      CHAT_CAPABILITY_KEY: 'conversation-secret',
    }, {})

    expect(response.status).toBe(403)
  })
})

describe('Worker stream finalization', () => {
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
      yield { type: 'RUN_ERROR', message: 'provider details' }
    }

    const events = []
    for await (const event of finalizeAssistantStream(source(), {
      onFinished: async () => calls.push('persist'),
      onFailed: async () => calls.push('release'),
    })) events.push(event)

    expect(calls).toEqual(['release'])
    expect(events.at(-1).message).toBe('The assistant could not answer that just now. Please try again.')
  })
})

describe('Worker transcript replay', () => {
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
    let prepared
    const db = {
      prepare(sql) {
        prepared = {
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
        }
        return prepared
      },
    }

    await expect(loadTranscript(db, 'thread-123')).resolves.toEqual([
      { role: 'user', content: 'Older', created_at: 3 },
      { role: 'assistant', content: 'Newest', created_at: 4 },
    ])
    expect(prepared.sql).toContain('ORDER BY created_at DESC, id DESC LIMIT ?')
    expect(prepared.binds).toEqual(['thread-123', 30])
  })

  it('rejects transcript replay without the conversation capability', async () => {
    const response = await worker.fetch(
      new Request('https://kwamina.fyi/api/chat/transcript', {
        headers: { 'x-chat-thread-id': 'thread-123' },
      }),
      { DB: { prepare: () => { throw new Error('D1 should not be read') } }, CHAT_CAPABILITY_KEY: 'conversation-secret' },
      {},
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'That conversation is not available in this browser.' })
  })

  it('fails closed for missing keys and malformed transcript capabilities before reading D1', async () => {
    const db = { prepare: () => { throw new Error('D1 should not be read') } }
    const missingKey = await worker.fetch(
      new Request('https://kwamina.fyi/api/chat/transcript', {
        headers: { 'x-chat-thread-id': 'thread-123' },
      }),
      { DB: db },
      {},
    )
    expect(missingKey.status).toBe(503)

    const malformed = await worker.fetch(
      new Request('https://kwamina.fyi/api/chat/transcript', {
        headers: {
          cookie: '__Host-chat-capability-thread-123=not-base64!@#',
          'x-chat-thread-id': 'thread-123',
        },
      }),
      { DB: db, CHAT_CAPABILITY_KEY: 'conversation-secret' },
      {},
    )
    expect(malformed.status).toBe(403)
  })

  it('replays the matching conversation without allowing it to be cached', async () => {
    const db = {
      prepare() {
        return {
          bind() { return this },
          async all() { return { results: [] } },
        }
      },
    }

    const capability = await conversationCapabilityFor('thread-123', 'conversation-secret')

    const response = await worker.fetch(
      new Request('https://kwamina.fyi/api/chat/transcript', {
        headers: {
          cookie: `__Host-chat-capability-thread-123=${capability}`,
          'x-chat-thread-id': 'thread-123',
        },
      }),
      { DB: db, CHAT_CAPABILITY_KEY: 'conversation-secret' },
      {},
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
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
})
