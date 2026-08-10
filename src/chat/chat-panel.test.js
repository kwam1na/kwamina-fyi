import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import {
  ChatRenderBoundary,
  chatInputPlaceholder,
  createChatScrollFollower,
  positionChatAtLatest,
  scrollChatToLatest,
} from './chat-panel.jsx'

describe('chatInputPlaceholder', () => {
  it('invites a follow-up after the assistant has replied', () => {
    expect(chatInputPlaceholder([])).toBe('Ask a question…')
    expect(chatInputPlaceholder([{ role: 'user' }])).toBe('Ask a question…')
    expect(chatInputPlaceholder([{ role: 'user' }, { role: 'assistant' }])).toBe('Ask a follow-up…')
  })
})

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

describe('positionChatAtLatest', () => {
  it('places the transcript at the bottom without smooth scrolling', () => {
    let behaviorWhenPositioned
    const log = {
      scrollHeight: 1_200,
      style: { scrollBehavior: '' },
      set scrollTop(value) {
        this.position = value
        behaviorWhenPositioned = this.style.scrollBehavior
      },
    }

    positionChatAtLatest(log)

    expect(log.position).toBe(1_200)
    expect(behaviorWhenPositioned).toBe('auto')
    expect(log.style.scrollBehavior).toBe('')
  })
})

describe('createChatScrollFollower', () => {
  it('starts a returning conversation at the bottom without keeping scroll control', () => {
    const log = { scrollHeight: 1_200, scrollTop: 100, style: { scrollBehavior: '' } }
    const follower = createChatScrollFollower(() => log)

    follower.mount(false)
    expect(log.scrollTop).toBe(100)

    follower.mount(true)
    expect(log.scrollTop).toBe(1_200)

    log.scrollHeight = 1_500
    follower.follow()
    expect(log.scrollTop).toBe(1_200)
  })

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

  it('catches a throwing message and renders the existing generic recovery alert', async () => {
    const captures = []
    const error = new Error('message render failed')
    const ThrowingMessage = () => { throw error }
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    const previousConsoleError = console.error
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    console.error = () => {}

    let renderer
    try {
      await act(async () => {
        renderer = create(createElement(
          ChatRenderBoundary,
          {
            renderContext: 'live_render',
            captureFailure: (...args) => captures.push(args),
          },
          createElement(ThrowingMessage),
        ))
      })

      expect(renderer.toJSON()).toMatchObject({
        type: 'p',
        props: { className: 'site-chat-error', role: 'alert' },
        children: ['Something went wrong. Try asking again.'],
      })
      expect(captures).toEqual([[error, 'live_render']])
    } finally {
      await act(async () => renderer?.unmount())
      console.error = previousConsoleError
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  })
})
