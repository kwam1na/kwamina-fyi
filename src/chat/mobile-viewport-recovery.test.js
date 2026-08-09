import { describe, expect, it } from 'bun:test'
import { watchMobileViewportRecovery } from './mobile-viewport-recovery.js'

function viewportFixture() {
  const listeners = new Map()
  return {
    height: 430,
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

function frameFixture() {
  const callbacks = new Map()
  let nextId = 1
  return {
    request(callback) {
      const id = nextId
      nextId += 1
      callbacks.set(id, callback)
      return id
    },
    cancel(id) {
      callbacks.delete(id)
    },
    flush() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback())
    },
    get size() {
      return callbacks.size
    },
  }
}

describe('mobile Safari viewport recovery', () => {
  it('refreshes root hit testing only after the keyboard viewport is restored', () => {
    const viewport = viewportFixture()
    const frames = frameFixture()
    const root = {
      scrollTop: 84,
      clientHeight: 844,
    }
    const stopWatching = watchMobileViewportRecovery({
      isMobile: true,
      viewport,
      root,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    })

    viewport.dispatch('resize')
    expect(root.scrollTop).toBe(84)
    frames.flush()
    expect(root.scrollTop).toBe(84)

    viewport.height = 844
    viewport.dispatch('resize')
    expect(root.scrollTop).toBe(84)
    frames.flush()
    expect(root.scrollTop).toBe(0)

    stopWatching()
    expect(viewport.hasListener('resize')).toBe(false)
  })

  it('coalesces resize bursts and cancels pending recovery during cleanup', () => {
    const viewport = viewportFixture()
    const frames = frameFixture()
    const root = {
      scrollTop: 84,
      clientHeight: 844,
    }
    const stopWatching = watchMobileViewportRecovery({
      isMobile: true,
      viewport,
      root,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    })

    viewport.dispatch('resize')
    viewport.dispatch('resize')
    expect(frames.size).toBe(1)

    stopWatching()
    expect(frames.size).toBe(0)
  })

  it('retries once when Safari restores the layout viewport a frame late', () => {
    const viewport = viewportFixture()
    const frames = frameFixture()
    const root = { scrollTop: 84, clientHeight: 430 }
    viewport.height = 844

    const stopWatching = watchMobileViewportRecovery({
      isMobile: true,
      viewport,
      root,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    })

    viewport.dispatch('resize')
    frames.flush()
    expect(root.scrollTop).toBe(84)
    expect(frames.size).toBe(1)

    root.clientHeight = 844
    frames.flush()
    expect(root.scrollTop).toBe(0)

    stopWatching()
  })

  it('stops after the bounded retry when viewport heights stay mismatched', () => {
    const viewport = viewportFixture()
    const frames = frameFixture()
    const root = { scrollTop: 84, clientHeight: 844 }

    const stopWatching = watchMobileViewportRecovery({
      isMobile: true,
      viewport,
      root,
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
    })

    viewport.dispatch('resize')
    frames.flush()
    frames.flush()

    expect(root.scrollTop).toBe(84)
    expect(frames.size).toBe(0)

    stopWatching()
  })

  it('does nothing outside a mobile visual viewport', () => {
    const viewport = viewportFixture()

    watchMobileViewportRecovery({ isMobile: false, viewport })()
    watchMobileViewportRecovery({ isMobile: true, viewport: null })()

    expect(viewport.hasListener('resize')).toBe(false)
  })
})
