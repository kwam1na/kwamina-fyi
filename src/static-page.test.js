import { describe, expect, it } from 'bun:test'
import { addCurrentYear, lightboxCaptureFor } from './static-page.jsx'

describe('current year', () => {
  it('fills authored year markers from the runtime date', () => {
    const html = '<p>&copy; <span data-current-year></span></p>'

    expect(addCurrentYear(html, new Date('2031-06-15T12:00:00Z')))
      .toBe('<p>&copy; <span data-current-year>2031</span></p>')
  })
})

describe('workspace capture lightbox', () => {
  it('opens the capture that was clicked directly', () => {
    const capture = {
      matches: (selector) => selector === '.workspace-capture',
      closest: () => null,
    }

    expect(lightboxCaptureFor(capture, false)).toBe(capture)
  })

  it('does not expand captures nested inside thumbnail selectors', () => {
    const capture = {
      matches: (selector) => selector === '.workspace-capture',
      closest: (selector) => selector === '.shot-thumb' ? { className: 'shot-thumb' } : null,
    }

    expect(lightboxCaptureFor(capture, false)).toBeNull()
  })

  it('uses the active theme capture for an expand affordance', () => {
    const light = { id: 'light' }
    const dark = { id: 'dark' }
    const frame = {
      querySelector: (selector) => selector.endsWith('--dark') ? dark : light,
    }
    const trigger = {
      matches: () => false,
      closest: (selector) => selector === '.establishing-shot, .capture-frame' ? frame : null,
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
