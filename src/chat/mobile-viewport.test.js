import { describe, expect, it } from 'bun:test'
import { watchMobileChatViewport } from './mobile-viewport.js'

function viewportFixture() {
  const listeners = new Map()
  return {
    height: 844,
    offsetTop: 72,
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
  it('tracks keyboard-driven height changes without following viewport panning', () => {
    const panel = panelFixture()
    const viewport = viewportFixture()
    const stopWatching = watchMobileChatViewport(panel, { isMobile: true, viewport })

    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('844px')

    viewport.height = 430
    viewport.dispatch('resize')

    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('430px')
    viewport.height = 844
    viewport.dispatch('resize')
    expect(panel.writes).toEqual([
      ['--mobile-chat-viewport-height', '844px'],
      ['--mobile-chat-viewport-height', '430px'],
      ['--mobile-chat-viewport-height', '844px'],
    ])
    expect(viewport.hasListener('scroll')).toBe(false)

    stopWatching()
    expect(viewport.hasListener('resize')).toBe(false)
    expect(panel.style.getPropertyValue('--mobile-chat-viewport-height')).toBe('')

    viewport.height = 430
    viewport.dispatch('resize')
    expect(panel.writes).toHaveLength(3)
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
