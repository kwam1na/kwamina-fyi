// Pure logic for the mobile reading-position control, kept out of the
// component so the reading line, the section arithmetic, and the glyph's
// geometry can be tested without a layout engine.

/** The rail itself, which the control stands in for once it is out of sight. */
export const RAIL_SELECTOR = '.context-rail'
/** The rail nav an article publishes for its own sections. */
export const RAIL_NAV_SELECTOR = '.rail-nav[aria-label="On this page"]'
/** The article's published reading estimate, first line of the same rail. */
export const RAIL_READTIME_SELECTOR = '.rail-readtime'

/**
 * Below this width the context rail stops being a sticky column beside the
 * article and stacks above it, where it scrolls away for good — which is the
 * whole reason this control exists. The number is the story layout's own
 * breakpoint (athena-story.css), not the chat's mobile takeover: the gap opens
 * at the moment the rail leaves the reader's view, not at the phone width.
 */
export const COMPACT_RAIL_QUERY = '(max-width: 980px)'

/**
 * Where "you are here" is measured: a third of the way down the viewport,
 * above the middle, because a section title that has just crossed the middle
 * has already been read past. Shared with the rail's own indicator so the two
 * cannot disagree about which section is current.
 */
export const READING_LINE_RATIO = 0.35

export function readingLineFor(viewportHeight) {
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0
  return height * READING_LINE_RATIO
}

/**
 * The article's sections, in document order, read from the rail it already
 * publishes. Nothing here invents structure: a page without a rail has no
 * position to report and gets no control.
 */
export function readRailSections(root = document) {
  const nav = root.querySelector(RAIL_NAV_SELECTOR)
  if (!nav) return []

  return [...nav.querySelectorAll('a[href^="#"]')]
    .map((link) => ({ id: link.hash.slice(1), label: link.textContent.trim() }))
    .filter((section) => section.id && root.getElementById?.(section.id))
}

/**
 * A band, not a line: at a single threshold a reader parked with the rail's
 * last pixel at the top edge would flicker the control on and off with every
 * small scroll correction. The control arrives the moment the rail is gone and
 * leaves only once a little of it is back.
 */
const RAIL_RETURN_PX = 24

/**
 * Whether the rail has left the viewport, which is when this control takes
 * over from it. Not a fixed scroll distance like the other two floating
 * controls use: what makes this one necessary is the rail going, and where
 * that happens depends on how long the article's hero runs.
 */
export function isPastRail(railBottom, wasPast = false) {
  if (!Number.isFinite(railBottom)) return wasPast
  return railBottom <= (wasPast ? RAIL_RETURN_PX : 0)
}

export function readRailReadTime(root = document) {
  return root.querySelector(RAIL_READTIME_SELECTOR)?.textContent.trim() ?? ''
}

/**
 * Whether two reads of the rail describe the same article. The observer that
 * watches for route changes also sees every DOM write the chat makes while it
 * streams; without this, each of those would re-render the control.
 */
export function isSameSectionList(a, b) {
  if (a.length !== b.length) return false
  return a.every((section, index) => (
    section.id === b[index].id && section.label === b[index].label
  ))
}

/**
 * The last section whose top has crossed the reading line. Before the first
 * one gets there the reader is still in the hero, which the rail treats as
 * being in section one — so does this.
 */
export function activeSectionIndex(tops, readingLine) {
  if (!tops.length) return -1
  let current = 0
  tops.forEach((top, index) => {
    if (top <= readingLine) current = index
  })
  return current
}

/**
 * How long after the last scroll event the page counts as still again. Short
 * enough that the panel comes back the moment the reader stops, long enough
 * that it does not flicker between the discrete events a single flick sends.
 */
export const SCROLL_QUIET_MS = 180

/**
 * Whether the page is being scrolled right now, as a subscription rather than
 * a position: what the panel reacts to is the act of scrolling, not where the
 * reader ended up.
 *
 * Deliberately not rAF-throttled. Everything else in this control reads layout
 * and so waits for a frame; this only flips a boolean, and putting it behind a
 * frame would delay the one thing that has to feel immediate — the panel
 * stepping back the instant the page starts moving.
 */
export function watchScrollActivity({
  onChange,
  target = globalThis.window,
  quietMs = SCROLL_QUIET_MS,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  let timer = null
  let isScrolling = false

  const settle = () => {
    timer = null
    isScrolling = false
    onChange(false)
  }

  const onScroll = () => {
    if (!isScrolling) {
      isScrolling = true
      onChange(true)
    }
    if (timer !== null) clearTimer(timer)
    timer = setTimer(settle, quietMs)
  }

  target.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    target.removeEventListener('scroll', onScroll)
    if (timer !== null) clearTimer(timer)
  }
}

// The glyph is the rail in miniature: three rules standing for the list, and a
// bar beside them holding the reader's place. These bound the bar's travel in
// the 18-unit viewBox, matched to the first and last rule.
export const GLYPH_TRACK_TOP = 4
export const GLYPH_TRACK_BOTTOM = 14

/**
 * Where the bar's top edge sits for a given section. The bar is centred on its
 * section's share of the track rather than on the section's own rule, so it
 * reports position across seven sections as readably as across three — the
 * rules are a picture of a list, not a count of one.
 */
export function glyphIndicatorY(index, count, barHeight = 5) {
  if (count <= 0) return GLYPH_TRACK_TOP - barHeight / 2
  const fraction = Math.min(1, Math.max(0, (index + 0.5) / count))
  const centre = GLYPH_TRACK_TOP + fraction * (GLYPH_TRACK_BOTTOM - GLYPH_TRACK_TOP)
  return Math.round((centre - barHeight / 2) * 100) / 100
}

/**
 * The control's accessible name. It carries the position rather than only the
 * function, so a screen reader gets the same answer sighted readers get from
 * the glyph without having to open anything.
 */
export function readingPositionLabel(sections, index) {
  if (!sections.length) return 'Article sections'
  const section = sections[Math.min(Math.max(index, 0), sections.length - 1)]
  return `Article sections — ${section.label}, ${index + 1} of ${sections.length}`
}
