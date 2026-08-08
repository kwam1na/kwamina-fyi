import { describe, expect, it } from 'bun:test'
import { watchMobileChatViewport } from './mobile-viewport.js'

function viewportFixture() {
  const listeners = new Map()
  return {
    height: 844,
    offsetTop: 0,
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
  return {
    style: {
      setProperty(name, value) {
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
  it('tracks the keyboard-sized viewport from the first focus', () => {
    const panel = panelFixture()
    const viewport = viewportFixture()
    const stopWatching = watchMobileChatViewport(panel, { isMobile: true, viewport })

    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('844px')
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-top')).toBe('0px')

    viewport.height = 430
    viewport.offsetTop = 12
    viewport.dispatch('resize')

    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('430px')
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-top')).toBe('12px')

    viewport.offsetTop = 18
    viewport.dispatch('scroll')
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-top')).toBe('18px')

    stopWatching()
    expect(viewport.hasListener('resize')).toBe(false)
    expect(viewport.hasListener('scroll')).toBe(false)
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('')
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-top')).toBe('')
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
