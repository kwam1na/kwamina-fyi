import { describe, expect, it } from 'bun:test'
import {
  ChatPanelFallback,
  collapseMobileChatOnSiteNavigation,
  createThread,
  lockMobilePageScroll,
  returningThread,
  shouldRestoreLauncherFocus,
  subscribeToMobileTakeover,
} from './chat-widget.jsx'

describe('ChatPanelFallback', () => {
  it('keeps a visible takeover surface mounted while the chat chunk loads', () => {
    const onClose = () => {}
    const fallback = ChatPanelFallback({ onClose })
    const header = fallback.props.children[0]
    const closeButton = header.props.children[1]

    expect(fallback.props.className).toBe('site-chat-panel')
    expect(fallback.props['aria-busy']).toBe('true')
    expect(fallback.props['aria-label']).toBe('Ask about Kwamina')
    expect(closeButton.props['aria-label']).toBe('Close chat')
    expect(closeButton.props.onClick).toBe(onClose)
  })
})

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

describe('collapseMobileChatOnSiteNavigation', () => {
  it('collapses the takeover before an internal route opens on mobile', () => {
    const events = []

    expect(collapseMobileChatOnSiteNavigation({
      isMobile: true,
      collapse: () => events.push('collapse'),
    })).toBe(true)
    expect(events).toEqual(['collapse'])
  })

  it('leaves the desktop panel open during internal navigation', () => {
    expect(collapseMobileChatOnSiteNavigation({
      isMobile: false,
      collapse: () => { throw new Error('should not collapse') },
    })).toBe(false)
  })

  it('ignores modified and non-primary link activations', () => {
    for (const event of [
      { defaultPrevented: true },
      { button: 1 },
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      expect(collapseMobileChatOnSiteNavigation({
        isMobile: true,
        event,
        collapse: () => { throw new Error('should not collapse') },
      })).toBe(false)
    }
  })
})

describe('subscribeToMobileTakeover', () => {
  it('keeps takeover behavior aligned when the breakpoint changes', () => {
    const states = []
    const media = {
      matches: false,
      addEventListener: (_name, listener) => { media.listener = listener },
      removeEventListener: (_name, listener) => { media.removed = listener },
    }

    const unsubscribe = subscribeToMobileTakeover((matches) => states.push(matches), media)
    media.matches = true
    media.listener()
    unsubscribe()

    expect(states).toEqual([false, true])
    expect(media.removed).toBe(media.listener)
  })
})

describe('shouldRestoreLauncherFocus', () => {
  it('does not paint focus around the launcher after a mobile tap closes chat', () => {
    expect(shouldRestoreLauncherFocus({ isMobile: true, event: { detail: 1 } })).toBe(false)
  })

  it('preserves return focus for keyboard and desktop closures', () => {
    expect(shouldRestoreLauncherFocus({ isMobile: true })).toBe(true)
    expect(shouldRestoreLauncherFocus({ isMobile: true, event: { detail: 0 } })).toBe(true)
    expect(shouldRestoreLauncherFocus({ isMobile: false, event: { detail: 1 } })).toBe(true)
  })
})

describe('lockMobilePageScroll', () => {
  it('hides page overflow without fixing the body and restores the exact scroll position', () => {
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
      position: 'relative',
      top: '',
      left: '',
      right: '',
      width: '',
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
