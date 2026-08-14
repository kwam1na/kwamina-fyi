import { describe, expect, it } from 'bun:test'
import { lightboxCaptureFor } from './static-page.jsx'

describe('workspace capture lightbox', () => {
  it('opens the capture that was clicked directly', () => {
    const capture = {
      matches: (selector) => selector === '.workspace-capture',
    }

    expect(lightboxCaptureFor(capture, false)).toBe(capture)
  })

  it('uses the active theme capture for an expand affordance', () => {
    const light = { id: 'light' }
    const dark = { id: 'dark' }
    const frame = {
      querySelector: (selector) => selector.endsWith('--dark') ? dark : light,
    }
    const trigger = {
      matches: () => false,
      closest: () => frame,
    }

    expect(lightboxCaptureFor(trigger, false)).toBe(light)
    expect(lightboxCaptureFor(trigger, true)).toBe(dark)
  })

  it('ignores expand affordances outside a capture frame', () => {
    const trigger = {
      matches: () => false,
      closest: () => null,
    }

    expect(lightboxCaptureFor(trigger, false)).toBeNull()
  })
})
