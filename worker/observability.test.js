import { describe, expect, it } from 'bun:test'
import {
  createOperationId,
  createWorkerObservability,
  sanitizeWorkerSentryIssue,
  sanitizeWorkerEvent,
  workerSentryOptions,
} from './observability.js'

const SENTINEL = 'private-chat-text-7c3f'

describe('Worker observability contract', () => {
  it('keeps approved fields and drops request, identity, content, and credential data', () => {
    const event = sanitizeWorkerEvent({
      event: 'assistant.operation',
      route: `/api/chat?prompt=${SENTINEL}`,
      environment: 'production',
      source: 'site',
      runKind: 'human',
      release: 'kwamina-fyi-worker@0123456789abcdef',
      stage: 'persistence',
      outcomeCode: 'PERSISTENCE_FAILED',
      statusClass: '5xx',
      durationMs: 245,
      operationId: 'op_0123456789abcdef0123456789abcdef',
      message: SENTINEL,
      threadId: `thread-${SENTINEL}`,
      callerHash: SENTINEL,
      headers: { cookie: SENTINEL },
      body: { prompt: SENTINEL },
      url: `https://kwamina.fyi/api/chat?prompt=${SENTINEL}`,
      referrer: SENTINEL,
      ip: '203.0.113.7',
      userAgent: SENTINEL,
      credentials: SENTINEL,
    })

    expect(event).toEqual({
      event: 'assistant.operation',
      route: 'api_chat',
      environment: 'production',
      source: 'site',
      runKind: 'human',
      release: 'kwamina-fyi-worker@0123456789abcdef',
      stage: 'persistence',
      outcomeCode: 'PERSISTENCE_FAILED',
      statusClass: '5xx',
      durationMs: 245,
      operationId: 'op_0123456789abcdef0123456789abcdef',
    })
    expect(JSON.stringify(event)).not.toContain(SENTINEL)
  })

  it('always creates a fresh authoritative operation ID', () => {
    const generated = [
      '01234567-89ab-4cde-8fab-0123456789ab',
      'fedcba98-7654-4321-8abc-fedcba987654',
    ]
    const randomUUID = () => generated.shift()

    expect(createOperationId({ clientCorrelation: 'op_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', randomUUID }))
      .toBe('op_0123456789ab4cde8fab0123456789ab')
    expect(createOperationId({ clientCorrelation: SENTINEL, randomUUID }))
      .toBe('op_fedcba98765443218abcfedcba987654')
  })

  it('bounds repeated expected refusals and never forwards them as issues', () => {
    const logs = []
    const issues = []
    const observability = createWorkerObservability({
      log: (event) => logs.push(event),
      captureIssue: (event) => issues.push(event),
      now: () => 120_000,
    })

    for (let index = 0; index < 20; index += 1) {
      observability.recordExpectedRefusal({
        event: 'assistant.refused',
        route: '/api/chat',
        environment: 'production',
        source: 'site',
        runKind: 'human',
        stage: 'admission',
        outcomeCode: 'RATE_LIMITED',
        message: `${SENTINEL}-${index}`,
      })
    }

    expect(logs).toHaveLength(1)
    expect(logs[0].occurrences).toBe(1)
    expect(issues).toEqual([])
    expect(JSON.stringify(logs)).not.toContain(SENTINEL)
  })

  it('fails open and does not recursively report transport failures', () => {
    let attempts = 0
    const observability = createWorkerObservability({
      log: () => { attempts += 1; throw new Error(SENTINEL) },
      captureIssue: () => { attempts += 1; throw new Error(SENTINEL) },
    })

    expect(() => observability.record({
      event: 'assistant.operation',
      route: '/api/chat',
      environment: 'production',
      outcomeCode: 'PERSISTENCE_FAILED',
    })).not.toThrow()
    expect(() => observability.captureActionableIssue({
      event: 'assistant.issue',
      route: '/api/chat',
      environment: 'production',
      outcomeCode: 'PERSISTENCE_FAILED',
    })).not.toThrow()
    expect(attempts).toBe(2)
  })

  it('keeps Worker Sentry disabled until ready and rebuilds issues from fixed fields', () => {
    expect(workerSentryOptions({
      OBSERVABILITY_PROVIDER_READY: 'false',
      SENTRY_DSN: 'https://public@example.invalid/1',
      SENTRY_RELEASE: 'kwamina-fyi-worker@0123456789abcdef',
    })).toBeNull()

    const options = workerSentryOptions({
      OBSERVABILITY_PROVIDER_READY: 'true',
      SENTRY_DSN: 'https://public@example.invalid/1',
      SENTRY_RELEASE: 'kwamina-fyi-worker@0123456789abcdef',
    })
    expect(options).toMatchObject({
      defaultIntegrations: false,
      enableLogs: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      sendClientReports: false,
    })

    const issue = sanitizeWorkerSentryIssue({
      release: options.release,
      environment: options.environment,
      message: SENTINEL,
      request: { url: `https://kwamina.fyi/api/chat?q=${SENTINEL}`, headers: { cookie: SENTINEL } },
      user: { id: SENTINEL, ip_address: '203.0.113.7' },
      extra: { prompt: SENTINEL },
      breadcrumbs: [{ message: SENTINEL }],
      tags: {
        event: 'assistant.issue',
        route: '/api/chat',
        stage: 'persistence',
        outcomeCode: 'PERSISTENCE_FAILED',
      },
    })
    expect(issue.exception.values[0]).toEqual({
      type: 'PERSISTENCE_FAILED',
      value: 'PERSISTENCE_FAILED',
    })
    expect(JSON.stringify(issue)).not.toContain(SENTINEL)
  })
})
