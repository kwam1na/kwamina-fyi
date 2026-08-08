import { describe, expect, it } from 'bun:test'
import { createThread, returningThread } from './chat-widget.jsx'

describe('createThread', () => {
  it('starts and persists a fresh conversation without transcript replay', () => {
    const writes = []
    const thread = createThread({
      randomUUID: () => 'thread-456',
      persist: (...args) => writes.push(args),
    })

    expect(thread).toEqual({
      id: 'thread-456',
      isReturning: false,
    })
    expect(writes).toEqual([['kwamina-fyi-chat-thread', 'thread-456']])
  })

  it('keeps the in-memory conversation when persistence is unavailable', () => {
    const thread = createThread({
      randomUUID: () => 'thread-789',
      persist: () => { throw new Error('denied') },
    })

    expect(thread).toEqual({ id: 'thread-789', isReturning: false })
  })
})

describe('returningThread', () => {
  it('preserves the existing conversation id and marks it for transcript replay', () => {
    expect(returningThread({ id: 'thread-123', isReturning: false })).toEqual({
      id: 'thread-123',
      isReturning: true,
    })
  })
})
