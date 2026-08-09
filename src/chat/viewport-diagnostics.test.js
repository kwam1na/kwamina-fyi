import { describe, expect, it } from 'bun:test'
import { readViewportGeometry } from './viewport-diagnostics.js'

describe('readViewportGeometry', () => {
  it('captures the viewport, panel, composer, and scroll positions', () => {
    const box = (top, bottom) => ({ top, bottom, height: bottom - top })

    expect(readViewportGeometry({
      panel: { getBoundingClientRect: () => box(0, 497) },
      composer: { getBoundingClientRect: () => box(372, 485) },
      viewport: { height: 497, offsetTop: 0, pageTop: 347, scale: 1 },
      windowObject: { innerHeight: 844, scrollY: 17 },
      documentObject: {
        activeElement: { tagName: 'TEXTAREA' },
        body: { scrollTop: 3 },
        documentElement: { clientHeight: 844, scrollTop: 5 },
      },
    })).toEqual({
      innerHeight: 844,
      layoutHeight: 844,
      viewportHeight: 497,
      viewportOffsetTop: 0,
      viewportPageTop: 347,
      viewportScale: 1,
      panelTop: 0,
      panelBottom: 497,
      panelHeight: 497,
      composerTop: 372,
      composerBottom: 485,
      composerHeight: 113,
      windowScrollY: 17,
      rootScrollTop: 5,
      bodyScrollTop: 3,
      composerFocused: true,
    })
  })
})
