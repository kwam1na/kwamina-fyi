import { describe, expect, it } from 'bun:test'
import { createThread, lockMobilePageScroll, returningThread } from './chat-widget.jsx'

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

describe('lockMobilePageScroll', () => {
  it('freezes the mobile page and restores its exact scroll position', () => {
    const classes = new Set()
    const body = {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      style: {
        position: 'relative',
        top: '',
        left: '',
        right: '',
        width: '',
        overflow: 'visible',
      },
    }
    const root = { style: { overflow: 'clip' } }
    const scrollCalls = []

    const unlock = lockMobilePageScroll({
      body,
      root,
      scrollY: 684,
      scrollTo: (...args) => scrollCalls.push(args),
      isMobile: true,
    })

    expect(classes.has('site-chat-open')).toBe(true)
    expect(body.style).toEqual({
      position: 'fixed',
      top: '-684px',
      left: '0px',
      right: '0px',
      width: '100%',
      overflow: 'hidden',
    })
    expect(root.style.overflow).toBe('hidden')

    unlock()

    expect(classes.has('site-chat-open')).toBe(false)
    expect(body.style).toEqual({
      position: 'relative',
      top: '',
      left: '',
      right: '',
      width: '',
      overflow: 'visible',
    })
    expect(root.style.overflow).toBe('clip')
    expect(scrollCalls).toEqual([[0, 684]])
  })

  it('does not alter the page outside the mobile takeover breakpoint', () => {
    const body = {
      classList: {
        add: () => { throw new Error('should not add a class') },
        remove: () => { throw new Error('should not remove a class') },
      },
      style: {},
    }
    const root = { style: {} }

    const unlock = lockMobilePageScroll({
      body,
      root,
      isMobile: false,
      scrollTo: () => { throw new Error('should not restore scroll') },
    })

    unlock()
    expect(body.style).toEqual({})
    expect(root.style).toEqual({})
  })
})
