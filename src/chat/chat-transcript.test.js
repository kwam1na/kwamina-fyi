import { describe, expect, it } from 'bun:test'
import {
  fetchEarlierMessages,
  fetchStoredMessages,
  memoryStateFromResponse,
  renderContextForChatMessage,
} from './chat-transcript.js'

describe('fetchStoredMessages', () => {
  it('maps stored transcript rows into chat messages', async () => {
    const calls = []
    const signal = new AbortController().signal
    const fetcher = async (...args) => {
      calls.push(args)
      return new Response(JSON.stringify({
        messages: [
          { role: 'user', content: 'What is Athena?' },
          { role: 'assistant', content: 'A business OS.' },
        ],
      }))
    }

    await expect(fetchStoredMessages('thread-123', { fetcher, signal })).resolves.toEqual({
      memory: null,
      hasEarlierMessages: false,
      memoryUnavailable: false,
      oldestMessageId: null,
      messages: [
        { id: 'stored-0', role: 'user', parts: [{ type: 'text', content: 'What is Athena?' }] },
        { id: 'stored-1', role: 'assistant', parts: [{ type: 'text', content: 'A business OS.' }] },
      ],
    })
    expect(calls).toEqual([['/api/chat/transcript', {
      signal,
      headers: { 'x-chat-thread-id': 'thread-123' },
    }]])
  })

  it('maps conversation memory separately from verbatim replay messages', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      memory: { content: 'Earlier discussion covered Dashy.', messageCount: 12, updatedAt: 50 },
      hasEarlierMessages: true,
      memoryUnavailable: false,
      oldestMessageId: null,
      messages: [{ id: 13, role: 'user', content: 'What happened next?' }],
    }))

    await expect(fetchStoredMessages('thread-123', { fetcher })).resolves.toEqual({
      memory: { content: 'Earlier discussion covered Dashy.', messageCount: 12, updatedAt: 50 },
      hasEarlierMessages: true,
      memoryUnavailable: false,
      oldestMessageId: null,
      messages: [{ id: 'stored-13', role: 'user', parts: [{ type: 'text', content: 'What happened next?' }] }],
    })
  })

  it('preserves a disclosed replay memory failure', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      memory: null,
      hasEarlierMessages: true,
      memoryUnavailable: true,
      oldestMessageId: 3,
      messages: [],
    }))

    await expect(fetchStoredMessages('thread-123', { fetcher })).resolves.toMatchObject({
      memory: null,
      hasEarlierMessages: true,
      memoryUnavailable: true,
      oldestMessageId: 3,
    })
  })

  it('fetches earlier transcript pages with the thread credential in a header', async () => {
    const calls = []
    const fetcher = async (...args) => {
      calls.push(args)
      return new Response(JSON.stringify({
        messages: [{ id: 4, role: 'assistant', content: 'Stored answer', created_at: 4 }],
        nextBeforeId: 4,
      }))
    }

    await expect(fetchEarlierMessages('thread-123', { beforeId: 8, fetcher })).resolves.toEqual({
      messages: [{ id: 4, role: 'assistant', content: 'Stored answer', created_at: 4 }],
      nextBeforeId: 4,
    })
    expect(calls).toEqual([['/api/chat/history?before=8', {
      signal: undefined,
      headers: { 'x-chat-thread-id': 'thread-123' },
    }]])
  })

  it('reads live memory state from response headers', () => {
    const response = new Response(null, {
      headers: {
        'x-chat-memory': encodeURIComponent(JSON.stringify({ content: 'Durable memory.', messageCount: 8, updatedAt: 40 })),
        'x-chat-has-earlier-messages': 'true',
        'x-chat-oldest-message-id': '9',
      },
    })

    expect(memoryStateFromResponse(response)).toEqual({
      memory: { content: 'Durable memory.', messageCount: 8, updatedAt: 40 },
      hasEarlierMessages: true,
      memoryUnavailable: false,
      oldestMessageId: 9,
    })
  })

  it('distinguishes replayed messages from live messages without reading content', () => {
    expect(renderContextForChatMessage({
      id: 'stored-2',
      parts: [{ type: 'text', content: 'private-replay-sentinel' }],
    })).toBe('replay_render')
    expect(renderContextForChatMessage({
      id: 'live-2',
      parts: [{ type: 'text', content: 'private-live-sentinel' }],
    })).toBe('live_render')
  })

  it('rejects a failed transcript response so the panel can offer recovery', async () => {
    const fetcher = async () => new Response(null, { status: 503 })

    await expect(fetchStoredMessages('thread-123', { fetcher })).rejects.toThrow(
      'Could not load the conversation.',
    )
  })
})
