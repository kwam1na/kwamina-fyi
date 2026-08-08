import { describe, expect, it } from 'bun:test'
import {
  shouldAutoFocusChatComposer,
  watchMobileChatViewport,
} from './mobile-viewport.js'

function viewportFixture() {
  const listeners = new Map()
  return {
    height: 844,
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
    dispatch(type) {
      listeners.get(type)?.()
    },
    hasListener(type) {
      return listeners.has(type)
    },
  }
}

function panelFixture() {
  const properties = new Map()
  const writes = []
  return {
    writes,
    style: {
      setProperty(name, value) {
        writes.push([name, value])
        properties.set(name, value)
      },
      removeProperty(name) {
        properties.delete(name)
      },
      getPropertyValue(name) {
        return properties.get(name) ?? ''
      },
    },
  }
}

describe('mobile chat visual viewport', () => {
  it('tracks the keyboard-sized viewport after explicit focus', () => {
    const panel = panelFixture()
    const viewport = viewportFixture()
    const stopWatching = watchMobileChatViewport(panel, { isMobile: true, viewport })

    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('844px')

    viewport.height = 430
    viewport.dispatch('resize')

    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('430px')

    viewport.dispatch('scroll')
    expect(viewport.hasListener('scroll')).toBe(false)
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('430px')

    stopWatching()
    expect(viewport.hasListener('resize')).toBe(false)
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('')
  })

  it('does not rewrite an unchanged viewport height during resize bursts', () => {
    const panel = panelFixture()
    const viewport = viewportFixture()
    watchMobileChatViewport(panel, { isMobile: true, viewport })

    viewport.dispatch('resize')
    expect(panel.writes).toEqual([['--mobile-chat-viewport-height', '844px']])
  })

  it('keeps the CSS fallback outside mobile visual viewports', () => {
    const panel = panelFixture()
    const viewport = viewportFixture()

    watchMobileChatViewport(panel, { isMobile: false, viewport })()
    watchMobileChatViewport(panel, { isMobile: true, viewport: null })()

    expect(viewport.hasListener('resize')).toBe(false)
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('')
  })
})

describe('chat composer focus', () => {
  it('waits for an explicit tap in takeover mode and autofocuses otherwise', () => {
    expect(shouldAutoFocusChatComposer({ isMobileTakeover: true })).toBe(false)
    expect(shouldAutoFocusChatComposer({ isMobileTakeover: false })).toBe(true)
  })
})
