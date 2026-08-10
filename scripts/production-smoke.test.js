import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  PRODUCTION_ORIGIN,
  SmokeFailure,
  runAssistantCanary,
  runContractChecks,
  runProductionSmoke,
} from './production-smoke.mjs'

const html = (body) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
})

const json = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const workflow = readFileSync(new URL('../.github/workflows/production-observability.yml', import.meta.url), 'utf8')
const workflowNotes = readFileSync(new URL('../.github/workflows/README.md', import.meta.url), 'utf8')

function sse(events, headers = {}) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-operation-id': 'op_0123456789abcdef0123456789abcdef',
      'x-run-kind': 'synthetic',
      ...headers,
    },
  })
}

describe('production contract checks', () => {
  it('pins the production origin and validates pages plus safe API contracts', async () => {
    const requests = []
    const fetcher = async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url === `${PRODUCTION_ORIGIN}/`) return html('<title>Kwamina Essuah Mensah</title>')
      if (url === `${PRODUCTION_ORIGIN}/work/athena/agent-ready-repository`) {
        return html('<div id="root"></div>')
      }
      if (url === `${PRODUCTION_ORIGIN}/api/observability-canary`) return json({ error: 'Not found.' }, 404)
      if (url === `${PRODUCTION_ORIGIN}/api/chat/transcript`) return json({ error: 'Malformed request.' }, 400)
      throw new Error('unexpected request')
    }

    await expect(runContractChecks({ fetcher })).resolves.toBeUndefined()
    expect(requests.map(({ url }) => url)).toEqual([
      `${PRODUCTION_ORIGIN}/`,
      `${PRODUCTION_ORIGIN}/work/athena/agent-ready-repository`,
      `${PRODUCTION_ORIGIN}/api/observability-canary`,
      `${PRODUCTION_ORIGIN}/api/chat/transcript`,
    ])
    expect(requests.every(({ init }) => init.redirect === 'manual')).toBe(true)
  })

  it.each([
    ['non-success', new Response('', { status: 503 })],
    ['wrong content type', new Response('<title>Kwamina Essuah Mensah</title>', { headers: { 'content-type': 'text/plain' } })],
    ['missing stable marker', html('<title>Different site</title>')],
    ['redirect', new Response('', { status: 302, headers: { location: 'https://elsewhere.example/' } })],
  ])('fails a page check with a bounded message for %s', async (_case, homepageResponse) => {
    const fetcher = async () => homepageResponse
    await expect(runContractChecks({ fetcher })).rejects.toEqual(
      new SmokeFailure('Homepage contract check failed.'),
    )
  })

  it('validates the nested canonical route against the shared SPA shell', async () => {
    const fetcher = async () => html('<title>Kwamina Essuah Mensah</title>')
    await expect(runContractChecks({ fetcher })).rejects.toEqual(
      new SmokeFailure('Nested page contract check failed.'),
    )
  })

  it('fails when API contracts drift without copying response content', async () => {
    const privateBody = 'private-response-content'
    const fetcher = async (input) => {
      if (String(input).endsWith('/')) return html('<title>Kwamina Essuah Mensah</title>')
      if (String(input).includes('/work/')) return html('<div id="root"></div>')
      return new Response(privateBody, { status: 500, headers: { 'content-type': 'text/plain' } })
    }

    let failure
    try { await runContractChecks({ fetcher }) } catch (error) { failure = error }
    expect(failure).toEqual(new SmokeFailure('Unknown API contract check failed.'))
    expect(String(failure)).not.toContain(privateBody)
  })
})

describe('assistant production canary', () => {
  it('requires a local secret before making any request', async () => {
    let calls = 0
    await expect(runAssistantCanary({ token: '', fetcher: async () => { calls += 1 } }))
      .rejects.toEqual(new SmokeFailure('CHAT_EVALUATION_TOKEN is required.'))
    expect(calls).toBe(0)
  })

  it('requires synthetic acknowledgement, drains terminal SSE, then verifies durable replay', async () => {
    const token = 'private-evaluation-token'
    const responseContent = 'private-assistant-response'
    const logs = []
    const requests = []
    const fetcher = async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/api/chat')) {
        return sse([
          { type: 'TEXT_MESSAGE_CONTENT', delta: responseContent },
          { type: 'RUN_FINISHED', threadId: 'server-value-that-is-not-used' },
        ])
      }
      if (url.endsWith('/api/chat/transcript')) {
        return json({
          messages: [
            { role: 'user', content: 'private-prompt-content' },
            { role: 'assistant', content: responseContent },
          ],
        }, 200)
      }
      throw new Error('unexpected request')
    }

    await expect(runAssistantCanary({
      token,
      fetcher,
      randomUUID: () => '12345678-1234-4123-8123-123456789abc',
      log: (message) => logs.push(message),
    })).resolves.toBeUndefined()

    expect(requests).toHaveLength(2)
    expect(requests[0].url).toBe(`${PRODUCTION_ORIGIN}/api/chat`)
    expect(requests[0].init.redirect).toBe('manual')
    expect(requests[0].init.headers['x-chat-evaluation-token']).toBe(token)
    expect(JSON.parse(requests[0].init.body)).toEqual(expect.objectContaining({
      threadId: '12345678-1234-4123-8123-123456789abc',
      runId: '12345678-1234-4123-8123-123456789abc',
      messages: [expect.objectContaining({ id: '12345678-1234-4123-8123-123456789abc' })],
    }))
    expect(requests[1].url).toBe(`${PRODUCTION_ORIGIN}/api/chat/transcript`)
    expect(requests[1].init.headers['x-chat-evaluation-token']).toBeUndefined()
    expect(requests[1].init.headers['x-chat-thread-id']).toBe('12345678-1234-4123-8123-123456789abc')
    const output = logs.join('\n')
    expect(output).not.toContain(token)
    expect(output).not.toContain(responseContent)
    expect(output).not.toContain('private-prompt-content')
    expect(output).not.toContain('12345678-1234-4123-8123-123456789abc')
  })

  it.each([
    ['invalid token acknowledgement', { 'x-run-kind': '' }, 'Assistant synthetic acknowledgement missing.'],
    ['operation acknowledgement', { 'x-operation-id': '' }, 'Assistant operation acknowledgement missing.'],
  ])('aborts on missing %s without replaying', async (_case, headers, message) => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return sse([{ type: 'RUN_FINISHED' }], headers)
    }
    await expect(runAssistantCanary({ token: 'invalid-or-unacknowledged', fetcher }))
      .rejects.toEqual(new SmokeFailure(message))
    expect(calls).toBe(1)
  })

  it('rejects a credential-bearing redirect without following it', async () => {
    const token = 'redirect-secret'
    const calls = []
    const fetcher = async (input, init) => {
      calls.push({ input: String(input), init })
      return new Response('', { status: 307, headers: { location: 'https://attacker.example/collect' } })
    }
    let failure
    try { await runAssistantCanary({ token, fetcher }) } catch (error) { failure = error }
    expect(failure).toEqual(new SmokeFailure('Assistant request redirected.'))
    expect(calls).toHaveLength(1)
    expect(String(failure)).not.toContain(token)
    expect(String(failure)).not.toContain('attacker.example')
  })

  it('fails without replay when the stream has no terminal event', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return sse([{ type: 'TEXT_MESSAGE_CONTENT', delta: 'private partial content' }])
    }
    await expect(runAssistantCanary({ token: 'configured', fetcher }))
      .rejects.toEqual(new SmokeFailure('Assistant terminal event missing.'))
    expect(calls).toBe(1)
  })

  it('bounds cumulative SSE bytes across individually small lines and skips replay', async () => {
    let calls = 0
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        for (let index = 0; index < 3; index += 1) {
          controller.enqueue(encoder.encode(`: ${'x'.repeat(90_000)}\n`))
        }
        controller.close()
      },
    })
    const fetcher = async () => {
      calls += 1
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'x-operation-id': 'op_0123456789abcdef0123456789abcdef',
          'x-run-kind': 'synthetic',
        },
      })
    }

    await expect(runAssistantCanary({ token: 'configured', fetcher }))
      .rejects.toEqual(new SmokeFailure('Assistant stream contract invalid.'))
    expect(calls).toBe(1)
  })
})

describe('production smoke orchestration', () => {
  it('sends an uncredentialed heartbeat only after every production check passes', async () => {
    const token = 'heartbeat-run-token'
    const heartbeatUrl = 'https://heartbeat.example/private-secret-path'
    const requests = []
    const fetcher = async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/')) return html('<title>Kwamina Essuah Mensah</title>')
      if (url.includes('/work/')) return html('<div id="root"></div>')
      if (url.endsWith('/api/observability-canary')) return json({}, 404)
      if (url.endsWith('/api/chat/transcript') && !init.headers['x-chat-thread-id']) return json({}, 400)
      if (url.endsWith('/api/chat')) return sse([{ type: 'RUN_FINISHED' }])
      if (url.endsWith('/api/chat/transcript')) {
        return json({ messages: [{ role: 'user' }, { role: 'assistant' }] }, 200)
      }
      if (url === heartbeatUrl) return new Response('', { status: 204 })
      throw new Error('unexpected request')
    }

    await expect(runProductionSmoke({
      token,
      heartbeatUrl,
      fetcher,
      randomUUID: () => '12345678-1234-4123-8123-123456789abc',
    })).resolves.toBeUndefined()
    const heartbeat = requests.at(-1)
    expect(heartbeat.url).toBe(heartbeatUrl)
    expect(heartbeat.init.redirect).toBe('manual')
    expect(heartbeat.init.headers?.['x-chat-evaluation-token']).toBeUndefined()
    expect(JSON.stringify(heartbeat.init)).not.toContain(token)
  })

  it('does not call the optional heartbeat until every production check passes', async () => {
    const calls = []
    const fetcher = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/')) return html('<title>Kwamina Essuah Mensah</title>')
      if (url.includes('/work/')) return html('<div id="root"></div>')
      if (url.endsWith('/api/observability-canary')) return json({}, 404)
      if (url.endsWith('/api/chat/transcript')) return json({}, 500)
      throw new Error('unexpected request')
    }
    await expect(runProductionSmoke({ token: 'configured', heartbeatUrl: 'https://heartbeat.example/private', fetcher }))
      .rejects.toBeInstanceOf(SmokeFailure)
    expect(calls).not.toContain('https://heartbeat.example/private')
  })
})

describe('production observability workflow', () => {
  it('is schedule/manual-only, protected, least-privilege, and immutable', () => {
    expect(workflow).toContain('schedule:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toContain('pull_request')
    expect(workflow).not.toContain('push:')
    expect(workflow).toContain('environment: production')
    expect(workflow).toContain('contents: read')
    expect(workflow).not.toContain('SENTRY_')
    const uses = [...workflow.matchAll(/^\s+uses:\s+\S+@([^\s#]+)/gm)].map((match) => match[1])
    expect(uses).toHaveLength(2)
    expect(uses.every((revision) => /^[a-f0-9]{40}$/.test(revision))).toBe(true)
  })

  it('documents bounded cadence, cost, row growth, secrets, and missed-run monitoring', () => {
    expect(workflowNotes).toContain('every six hours')
    expect(workflowNotes).toContain('$5')
    expect(workflowNotes).toContain('150')
    expect(workflowNotes).toContain('CHAT_EVALUATION_TOKEN')
    expect(workflowNotes).toContain('CANARY_HEARTBEAT_URL')
    expect(workflowNotes).toContain('lateness tolerance')
  })
})
