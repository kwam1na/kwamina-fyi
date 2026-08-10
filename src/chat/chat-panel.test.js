import { describe, expect, it } from 'bun:test'
import {
  ChatRenderBoundary,
  createChatScrollFollower,
  scrollChatToLatest,
} from './chat-panel.jsx'

describe('scrollChatToLatest', () => {
  it('brings a new response into view even after the visitor scrolled up', () => {
    const log = {
      clientHeight: 300,
      scrollHeight: 1_200,
      scrollTop: 100,
    }

    scrollChatToLatest(log)

    expect(log.scrollTop).toBe(1_200)
  })
})

describe('createChatScrollFollower', () => {
  it('stops following streaming updates after the visitor intervenes', () => {
    const log = { scrollHeight: 1_200, scrollTop: 100 }
    const follower = createChatScrollFollower(() => log)

    follower.start()
    expect(log.scrollTop).toBe(1_200)

    follower.interrupt()
    log.scrollHeight = 1_500
    follower.follow()

    expect(log.scrollTop).toBe(1_200)

    follower.start()
    expect(log.scrollTop).toBe(1_500)
  })
})

describe('ChatRenderBoundary', () => {
  it('reports replay rendering with bounded context only', () => {
    const calls = []
    const error = new Error('private-replay-message')
    const boundary = new ChatRenderBoundary({
      renderContext: 'replay_render',
      captureFailure: (...args) => calls.push(args),
    })

    boundary.componentDidCatch(error)

    expect(calls).toEqual([[error, 'replay_render']])
  })
})
