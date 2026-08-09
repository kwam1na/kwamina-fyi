import { describe, expect, it } from 'bun:test'
import {
  ChatPanelFallback,
  CHAT_LAUNCHER_ARIA_LABEL,
  CHAT_LAUNCHER_LABEL,
  collapseMobileChatOnSiteNavigation,
  createThread,
  lockMobilePageScroll,
  returningThread,
  shouldRestoreLauncherFocus,
  shouldSweepLauncher,
  subscribeToMobileTakeover,
  watchMobileViewportRestoration,
} from './chat-widget.jsx'

describe('chat launcher copy', () => {
  it('presents the trigger as chat in visible and accessible text', () => {
    expect(CHAT_LAUNCHER_LABEL).toBe('Chat')
    expect(CHAT_LAUNCHER_ARIA_LABEL).toBe('Chat with Kwamina')
  })
})

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

describe('shouldSweepLauncher', () => {
  it('sweeps the labelled pill on a first, motion-tolerant sighting', () => {
    expect(shouldSweepLauncher({ isLabelled: true })).toBe(true)
  })

  it('waits for the label rather than sweeping a disc that has nothing to cross', () => {
    expect(shouldSweepLauncher({ isLabelled: false })).toBe(false)
  })

  it('spends the sweep once, so it stays an introduction', () => {
    expect(shouldSweepLauncher({ isLabelled: true, hasSwept: true })).toBe(false)
  })

  it('never sweeps for a reader who asked for less motion', () => {
    expect(shouldSweepLauncher({ isLabelled: true, prefersReducedMotion: true })).toBe(false)
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

describe('watchMobileViewportRestoration', () => {
  it('returns the takeover to the top after the keyboard viewport fully reopens', () => {
    const listeners = new Map()
    const viewport = {
      height: 430,
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      },
    }
    const root = { clientHeight: 844, scrollTop: 318 }
    const body = { scrollTop: 318 }
    let scheduledFrame = null
    const stopWatching = watchMobileViewportRestoration({
      isMobile: true,
      viewport,
      root,
      body,
      requestFrame: (callback) => {
        scheduledFrame = callback
        return 1
      },
      cancelFrame: () => {
        scheduledFrame = null
      },
    })

    listeners.get('resize')()
    scheduledFrame()
    expect(root.scrollTop).toBe(318)
    expect(body.scrollTop).toBe(318)

    viewport.height = 844
    listeners.get('resize')()
    scheduledFrame()
    expect(root.scrollTop).toBe(0)
    expect(body.scrollTop).toBe(0)

    stopWatching()
    expect(listeners.has('resize')).toBe(false)
  })

  it('clears Safari keyboard scroll after layout height returns before visualViewport', () => {
    const documentListeners = new Map()
    const timers = []
    const textarea = { tagName: 'TEXTAREA' }
    const documentObject = {
      activeElement: null,
      addEventListener: (type, listener) => documentListeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (documentListeners.get(type) === listener) documentListeners.delete(type)
      },
    }
    const windowObject = { innerHeight: 430 }
    const viewport = {
      height: 430,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    const root = { clientHeight: 844, scrollTop: 318 }
    const body = { scrollTop: 318 }

    const stopWatching = watchMobileViewportRestoration({
      isMobile: true,
      viewport,
      root,
      body,
      documentObject,
      windowObject,
      setTimer: (callback, delay) => {
        timers.push({ callback, delay })
        return timers.length
      },
      clearTimer: () => {},
    })

    documentListeners.get('focusout')({ target: textarea })
    timers.find(({ delay }) => delay === 250).callback()
    expect(root.scrollTop).toBe(318)

    // Production Safari reports the full layout height around a second before
    // visualViewport.height and offsetTop catch up.
    windowObject.innerHeight = 844
    timers.find(({ delay }) => delay === 1000).callback()
    expect(viewport.height).toBe(430)
    expect(root.scrollTop).toBe(0)
    expect(body.scrollTop).toBe(0)

    stopWatching()
    expect(documentListeners.has('focusout')).toBe(false)
  })
})
