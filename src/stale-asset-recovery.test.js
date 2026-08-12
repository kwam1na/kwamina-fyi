import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { installStaleAssetRecovery } from './stale-asset-recovery.js'

function recoveryTarget() {
  const listeners = new Map()
  let reloads = 0

  return {
    addEventListener(type, handler) {
      listeners.set(type, handler)
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    location: {
      reload() {
        reloads += 1
      },
    },
    dispatch(event) {
      listeners.get('vite:preloadError')?.(event)
    },
    get reloads() {
      return reloads
    },
  }
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    storedValues() {
      return [...values.values()]
    },
  }
}

describe('stale asset recovery', () => {
  it('reloads once when a deployed lazy chunk is no longer available', () => {
    const target = recoveryTarget()
    const storage = memoryStorage()
    let prevented = 0
    const event = { preventDefault: () => { prevented += 1 } }

    installStaleAssetRecovery({ target, storage, now: () => 10_000 })
    target.dispatch(event)
    target.dispatch(event)

    expect(target.reloads).toBe(1)
    expect(prevented).toBe(1)
    expect(storage.storedValues()).toEqual(['10000'])
  })

  it('fails open when session storage cannot provide a reload guard', () => {
    const target = recoveryTarget()
    Object.defineProperty(target, 'sessionStorage', {
      get() {
        throw new Error('storage unavailable')
      },
    })

    expect(() => installStaleAssetRecovery({ target })).not.toThrow()
    expect(() => target.dispatch({ preventDefault() {} })).not.toThrow()
    expect(target.reloads).toBe(0)
  })

  it('starts recovery before React renders', () => {
    const source = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8')
    const recoveryStart = source.indexOf('installStaleAssetRecovery()')
    const reactRendering = source.indexOf("createRoot(document.getElementById('root'))")

    expect(recoveryStart).toBeGreaterThan(-1)
    expect(reactRendering).toBeGreaterThan(recoveryStart)
  })
})
