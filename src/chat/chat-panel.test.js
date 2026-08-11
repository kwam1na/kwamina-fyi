import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import {
  ChatRenderBoundary,
  ChatLatestButton,
  StreamingText,
  chatIsAwayFromLatest,
  chatInputPlaceholder,
  createChatScrollFollower,
  positionChatAtLatest,
  scrollChatToLatest,
  shouldShowThinking,
  triggerCompletionHaptic,
} from './chat-panel.jsx'

function renderedText(node) {
  if (typeof node === 'string') return node
  if (!node) return ''
  return (node.children ?? []).map(renderedText).join('')
}

describe('chatIsAwayFromLatest', () => {
  it('shows the latest-message affordance only beyond the bottom tolerance', () => {
    const log = { scrollHeight: 1_000, clientHeight: 300, scrollTop: 660 }

    expect(chatIsAwayFromLatest(log)).toBe(true)

    log.scrollTop = 676
    expect(chatIsAwayFromLatest(log)).toBe(false)

    log.scrollHeight = 1_100
    expect(chatIsAwayFromLatest(log)).toBe(true)
    expect(chatIsAwayFromLatest(null)).toBe(false)
  })
})

describe('StreamingText', () => {
  it('notifies scroll followers after revealed text reaches the rendered tree', async () => {
    const previousWindow = globalThis.window
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.window = { matchMedia: () => ({ matches: true }) }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const revealedTrees = []
    let renderer

    try {
      await act(async () => {
        renderer = create(createElement(StreamingText, {
          text: 'First',
          isStreaming: false,
          onReveal: () => revealedTrees.push(renderedText(renderer?.toJSON())),
        }))
      })
      revealedTrees.length = 0

      await act(async () => {
        renderer.update(createElement(StreamingText, {
          text: 'First and second',
          isStreaming: true,
          onReveal: () => revealedTrees.push(renderedText(renderer.toJSON())),
        }))
      })

      expect(revealedTrees.at(-1)).toBe('First and second')
    } finally {
      await act(async () => renderer?.unmount())
      globalThis.window = previousWindow
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  })
})

describe('ChatLatestButton', () => {
  it('enters the focus order only while visible and invokes its scroll action', async () => {
    const calls = []
    let renderer

    await act(async () => {
      renderer = create(createElement(ChatLatestButton, {
        isVisible: false,
        onClick: () => calls.push('latest'),
      }))
    })

    expect(renderer.root.findByType('button').props).toMatchObject({
      'aria-hidden': true,
      tabIndex: -1,
    })

    await act(async () => {
      renderer.update(createElement(ChatLatestButton, {
        isVisible: true,
        onClick: () => calls.push('latest'),
      }))
    })

    const button = renderer.root.findByType('button')
    expect(button.props).toMatchObject({
      'aria-label': 'Scroll to latest message',
      'aria-hidden': false,
      tabIndex: 0,
    })
    button.props.onClick()
    expect(calls).toEqual(['latest'])

    await act(async () => renderer.unmount())
  })
})

describe('chatInputPlaceholder', () => {
  it('invites a follow-up after the assistant has replied', () => {
    expect(chatInputPlaceholder([])).toBe('Ask a question…')
    expect(chatInputPlaceholder([{ role: 'user' }])).toBe('Ask a question…')
    expect(chatInputPlaceholder([{ role: 'user' }, { role: 'assistant' }])).toBe('Ask a follow-up…')
  })
})

describe('shouldShowThinking', () => {
  it('shows only while waiting for the first assistant text', () => {
    const userMessage = { role: 'user', parts: [{ type: 'text', content: 'Hello' }] }
    const emptyAssistant = { role: 'assistant', parts: [] }
    const streamingAssistant = {
      role: 'assistant',
      parts: [{ type: 'text', content: 'Hi' }],
    }

    expect(shouldShowThinking([userMessage], true)).toBe(true)
    expect(shouldShowThinking([userMessage, emptyAssistant], true)).toBe(true)
    expect(shouldShowThinking([userMessage, streamingAssistant], true)).toBe(false)
    expect(shouldShowThinking([userMessage], false)).toBe(false)
  })
})

describe('triggerCompletionHaptic', () => {
  const assistant = { role: 'assistant', parts: [{ type: 'text', content: 'Done' }] }

  it('pulses once when a mobile response completes', () => {
    const pulses = []

    expect(triggerCompletionHaptic({
      wasLoading: true,
      isLoading: false,
      messages: [assistant],
      error: null,
      isMobile: true,
      vibrate: (duration) => pulses.push(duration),
    })).toBe(true)
    expect(pulses).toEqual([10])
  })

  it('does not pulse mid-stream, on desktop, or after a failed response', () => {
    const vibrate = () => { throw new Error('should not vibrate') }
    const base = { wasLoading: true, messages: [assistant], error: null, isMobile: true, vibrate }

    expect(triggerCompletionHaptic({ ...base, isLoading: true })).toBe(false)
    expect(triggerCompletionHaptic({ ...base, isLoading: false, isMobile: false })).toBe(false)
    expect(triggerCompletionHaptic({ ...base, isLoading: false, error: new Error('failed') })).toBe(false)
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
