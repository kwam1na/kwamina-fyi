import { describe, expect, it } from 'bun:test'
import { fetchStoredMessages, renderContextForChatMessage } from './chat-transcript.js'

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

    await expect(fetchStoredMessages('thread-123', { fetcher, signal })).resolves.toEqual([
      { id: 'stored-0', role: 'user', parts: [{ type: 'text', content: 'What is Athena?' }] },
      { id: 'stored-1', role: 'assistant', parts: [{ type: 'text', content: 'A business OS.' }] },
    ])
    expect(calls).toEqual([['/api/chat/transcript', {
      signal,
      headers: { 'x-chat-thread-id': 'thread-123' },
    }]])
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
