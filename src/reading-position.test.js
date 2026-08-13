import { describe, expect, it } from 'bun:test'
import {
  COMPACT_RAIL_QUERY,
  GLYPH_TRACK_BOTTOM,
  GLYPH_TRACK_TOP,
  activeSectionIndex,
  glyphIndicatorY,
  isPastRail,
  isSameSectionList,
  readRailReadTime,
  readRailSections,
  readingLineFor,
  readingPositionLabel,
  watchScrollActivity,
} from './reading-position.js'

// Enough of a document to answer the two queries this module makes of one.
function stubDocument({ links = [], readTime = null, missingIds = [] } = {}) {
  const nav = links.length
    ? {
        querySelectorAll: () => links.map(([id, label]) => ({
          hash: `#${id}`,
          textContent: label,
        })),
      }
    : null

  return {
    querySelector: (selector) => (selector.includes('rail-readtime')
      ? (readTime === null ? null : { textContent: readTime })
      : nav),
    getElementById: (id) => (missingIds.includes(id) ? null : { id }),
  }
}

describe('readingLineFor', () => {
  it('measures the reading line above the middle of the viewport', () => {
    expect(readingLineFor(1000)).toBe(350)
    expect(readingLineFor(812)).toBeCloseTo(284.2)
  })

  it('survives a viewport that has not been measured yet', () => {
    expect(readingLineFor(0)).toBe(0)
    expect(readingLineFor(-800)).toBe(0)
    expect(readingLineFor(Number.NaN)).toBe(0)
  })
})

describe('readRailSections', () => {
  it('reads the article\'s sections from the rail it already publishes', () => {
    const sections = readRailSections(stubDocument({
      links: [['online-first', 'The online-first failure'], ['limits', 'A bounded promise']],
    }))

    expect(sections).toEqual([
      { id: 'online-first', label: 'The online-first failure' },
      { id: 'limits', label: 'A bounded promise' },
    ])
  })

  it('reports nothing on a page without a rail', () => {
    expect(readRailSections(stubDocument())).toEqual([])
  })

  it('drops links whose section is not on the page', () => {
    const sections = readRailSections(stubDocument({
      links: [['here', 'Here'], ['elsewhere', 'Elsewhere']],
      missingIds: ['elsewhere'],
    }))

    expect(sections).toEqual([{ id: 'here', label: 'Here' }])
  })
})

describe('readRailReadTime', () => {
  it('reports the article\'s published estimate', () => {
    expect(readRailReadTime(stubDocument({ readTime: ' 5 min read ' }))).toBe('5 min read')
  })

  it('reports nothing when the article publishes none', () => {
    expect(readRailReadTime(stubDocument())).toBe('')
  })
})

describe('isPastRail', () => {
  it('waits for the rail to clear the top of the viewport', () => {
    expect(isPastRail(180)).toBe(false)
    expect(isPastRail(1)).toBe(false)
    expect(isPastRail(0)).toBe(true)
    expect(isPastRail(-400)).toBe(true)
  })

  it('holds on through a small scroll back rather than flickering', () => {
    // Parked with the rail's last pixels at the edge: showing, and a 20px
    // correction upward does not take the control away again.
    expect(isPastRail(20, true)).toBe(true)
    expect(isPastRail(40, true)).toBe(false)
  })

  it('stays as it is when the rail cannot be measured', () => {
    expect(isPastRail(Number.NaN, true)).toBe(true)
    expect(isPastRail(Number.NaN, false)).toBe(false)
  })
})

describe('watchScrollActivity', () => {
  // A window that can be scrolled on demand, and a clock that only advances
  // when the test says so.
  function harness() {
    const listeners = new Map()
    const timers = new Map()
    let nextTimer = 1
    const changes = []

    const stop = watchScrollActivity({
      onChange: (isScrolling) => changes.push(isScrolling),
      quietMs: 180,
      target: {
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type, listener) => {
          if (listeners.get(type) === listener) listeners.delete(type)
        },
      },
      setTimer: (callback) => {
        const id = nextTimer++
        timers.set(id, callback)
        return id
      },
      clearTimer: (id) => timers.delete(id),
    })

    return {
      changes,
      listeners,
      timers,
      stop,
      scroll: () => listeners.get('scroll')(),
      settle: () => [...timers.values()].forEach((run) => run()),
    }
  }

  it('reports the page moving on the first event and still again once it quiets', () => {
    const page = harness()
    page.scroll()
    expect(page.changes).toEqual([true])

    page.settle()
    expect(page.changes).toEqual([true, false])
  })

  it('reports one movement, not one per event, through a flick', () => {
    const page = harness()
    page.scroll()
    page.scroll()
    page.scroll()

    // A single flick sends a burst of events; the panel gives way once.
    expect(page.changes).toEqual([true])
    // And only the last event's timer is left to decide when it is over.
    expect(page.timers.size).toBe(1)
  })

  it('starts a fresh movement after the page has come to rest', () => {
    const page = harness()
    page.scroll()
    page.settle()
    page.scroll()

    expect(page.changes).toEqual([true, false, true])
  })

  it('leaves nothing listening or pending on teardown', () => {
    const page = harness()
    page.scroll()
    page.stop()

    expect(page.listeners.size).toBe(0)
    expect(page.timers.size).toBe(0)
  })
})

describe('isSameSectionList', () => {
  const sections = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]

  it('holds a re-read of the same article steady', () => {
    expect(isSameSectionList(sections, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])).toBe(true)
  })

  it('notices a different article', () => {
    expect(isSameSectionList(sections, [{ id: 'a', label: 'A' }])).toBe(false)
    expect(isSameSectionList(sections, [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }])).toBe(false)
    // A retitled section is a different rail even at the same anchor.
    expect(isSameSectionList(sections, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B2' }])).toBe(false)
  })
})

describe('activeSectionIndex', () => {
  it('reports the last section to have crossed the reading line', () => {
    expect(activeSectionIndex([-800, -200, 400, 1200], 350)).toBe(1)
  })

  it('stays on the first section while the reader is still above it', () => {
    expect(activeSectionIndex([200, 900, 1600], 350)).toBe(0)
    expect(activeSectionIndex([900, 1600], 350)).toBe(0)
  })

  it('reports the last section at the foot of the page', () => {
    expect(activeSectionIndex([-2000, -1400, -600], 350)).toBe(2)
  })

  it('has nothing to report without sections', () => {
    expect(activeSectionIndex([], 350)).toBe(-1)
  })
})

describe('glyphIndicatorY', () => {
  const centre = (index, count) => glyphIndicatorY(index, count, 5) + 2.5

  it('keeps the bar inside the track at both ends', () => {
    expect(centre(0, 7)).toBeGreaterThanOrEqual(GLYPH_TRACK_TOP)
    expect(centre(6, 7)).toBeLessThanOrEqual(GLYPH_TRACK_BOTTOM)
  })

  it('places the middle section at the middle of the track', () => {
    expect(centre(3, 7)).toBeCloseTo((GLYPH_TRACK_TOP + GLYPH_TRACK_BOTTOM) / 2)
    expect(centre(0, 1)).toBeCloseTo((GLYPH_TRACK_TOP + GLYPH_TRACK_BOTTOM) / 2)
  })

  it('advances monotonically through the sections', () => {
    const positions = [0, 1, 2, 3, 4].map((index) => centre(index, 5))
    positions.slice(1).forEach((position, index) => {
      expect(position).toBeGreaterThan(positions[index])
    })
  })

  it('clamps an index outside the list rather than leaving the track', () => {
    expect(centre(-4, 5)).toBeGreaterThanOrEqual(GLYPH_TRACK_TOP)
    expect(centre(40, 5)).toBeLessThanOrEqual(GLYPH_TRACK_BOTTOM)
  })

  it('has a resting place with nothing to report', () => {
    expect(glyphIndicatorY(0, 0, 5)).toBe(GLYPH_TRACK_TOP - 2.5)
  })
})

describe('readingPositionLabel', () => {
  const sections = [
    { id: 'a', label: 'Local evidence first' },
    { id: 'b', label: 'One operating path' },
  ]

  it('carries the position, not only the function', () => {
    expect(readingPositionLabel(sections, 1)).toBe(
      'Article sections — One operating path, 2 of 2',
    )
  })

  it('names itself when there is no rail to report on', () => {
    expect(readingPositionLabel([], 0)).toBe('Article sections')
  })
})

describe('COMPACT_RAIL_QUERY', () => {
  it('opens at the width where the rail stops being a sticky column', () => {
    // athena-story.css turns .context-rail static at this breakpoint; the gap
    // this control fills starts there, not at the phone width.
    expect(COMPACT_RAIL_QUERY).toBe('(max-width: 980px)')
  })
})
