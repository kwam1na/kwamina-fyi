import { useCallback, useEffect, useRef, useState } from 'react'
import { useFooterOverlap } from './use-footer-overlap.js'
import {
  COMPACT_RAIL_QUERY,
  RAIL_NAV_SELECTOR,
  RAIL_SELECTOR,
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

// The bar's height in the glyph's 18-unit viewBox. Here rather than in the
// geometry module's default because the markup below is what has to agree
// with it.
const GLYPH_BAR_HEIGHT = 5

function useCompactRail() {
  const [isCompact, setIsCompact] = useState(
    () => window.matchMedia(COMPACT_RAIL_QUERY).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(COMPACT_RAIL_QUERY)
    const update = () => setIsCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return isCompact
}

/**
 * Which sections this page has, and how long it says it takes to read. Both
 * come from the rail the article already publishes — this control never
 * invents structure, so a page without a rail simply has no position to report.
 *
 * Re-read on route changes, which swap the article under the control without a
 * scroll or resize event to announce it. The observer sees every other write
 * inside #root too — the chat streams tokens through it — so the result is
 * compared before it is committed, and an unchanged article costs no render.
 */
function useRailSections() {
  const [sections, setSections] = useState([])
  const [readTime, setReadTime] = useState('')

  useEffect(() => {
    let frame = 0

    const read = () => {
      frame = 0
      const next = readRailSections()
      setSections((current) => (isSameSectionList(current, next) ? current : next))
      setReadTime(readRailReadTime())
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read)
    }

    read()
    const observer = new MutationObserver(schedule)
    observer.observe(document.getElementById('root'), { childList: true, subtree: true })

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return { sections, readTime }
}

/**
 * The reader's place in the article, and whether the rail that reports it has
 * left the viewport. Both are read on the same frame from the same scroll
 * position, so the control cannot arrive reporting a section the reader has
 * already passed.
 *
 * The other two floating controls appear at a fixed scroll distance, because
 * what they offer is available at any depth. This one is a stand-in for
 * something on the page, so it waits for that thing to go — a handoff at the
 * rail's own bottom edge, wherever the article's hero happens to put it,
 * rather than a distance that would guess at it.
 */
function useReadingPosition(sections) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!sections.length) {
      setIsVisible(false)
      return undefined
    }

    let frame = 0
    let currentIndex = -1
    let currentVisible = null
    // Resolved on each read rather than cached: a route swap replaces these
    // elements, and a cached list would report the old article's positions.
    const read = () => {
      frame = 0
      const tops = sections.map(
        (section) => document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity,
      )

      const nextIndex = activeSectionIndex(tops, readingLineFor(window.innerHeight))
      if (nextIndex >= 0 && nextIndex !== currentIndex) {
        currentIndex = nextIndex
        setActiveIndex(nextIndex)
      }

      // Measured live rather than remembered: the rail is in normal flow at
      // this width, so its position moves with everything above it — an image
      // finishing loading is enough to shift it.
      const rail = document.querySelector(RAIL_SELECTOR)
      const nextVisible = isPastRail(
        rail?.getBoundingClientRect().bottom ?? Number.NaN,
        currentVisible === true,
      )
      if (nextVisible !== currentVisible) {
        currentVisible = nextVisible
        setIsVisible(nextVisible)
      }
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read)
    }

    read()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })

    // The handoff happens at a place in the layout rather than at a scroll
    // distance, so anything that moves the layout — a late image, a figure
    // sizing itself — moves the handoff with it, without a scroll to announce
    // it.
    const observer = 'ResizeObserver' in window ? new ResizeObserver(schedule) : null
    observer?.observe(document.body)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [sections])

  return { activeIndex, isVisible }
}

/**
 * Third control in the corner cluster, and the only one that exists solely for
 * narrow screens.
 *
 * On a wide screen the context rail sits beside the article and stays put; the
 * reader always knows which section they are in and what else is on the page.
 * Below 980px that rail stacks above the article and scrolls away, so the
 * answer to "where am I" leaves with it. This puts the rail back within reach
 * without putting it back on screen: a disc carrying the rail in miniature,
 * and, on tap, the rail itself growing out of the disc that opened it.
 *
 * It arrives as the rail leaves — the two never share the screen — so what the
 * reader sees is one thing moving to the corner, not a second copy of it.
 *
 * Nothing here duplicates the rail's navigation. Choosing a section forwards
 * the click to the rail's own link, so routing, hash handling, and the smooth
 * scroll all stay in the one place that already owns them.
 */
export function ReadingPosition() {
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isPageScrolling, setIsPageScrolling] = useState(false)
  const isCompact = useCompactRail()
  const { sections, readTime } = useRailSections()
  const { activeIndex, isVisible } = useReadingPosition(sections)
  const isOnFooter = useFooterOverlap(triggerRef)

  const close = useCallback(({ restoreFocus = false } = {}) => {
    setIsOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // A control that has scrolled back out of the cluster must not leave its
  // popover hanging over the top of the page.
  useEffect(() => {
    if (!isVisible) setIsOpen(false)
  }, [isVisible])

  // Scrolling with the panel up is the one time the reader wants both at once:
  // the article moving, and the list saying where they are moving to. Only
  // watched while it is open — a closed panel has nothing to get out of the
  // way of.
  useEffect(() => {
    if (!isOpen) {
      setIsPageScrolling(false)
      return undefined
    }
    return watchScrollActivity({ onChange: setIsPageScrolling })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined

    // On click rather than pointerdown, which is the one place this control
    // does not respond on press: a scroll gesture begins with a press on the
    // page, and dismissing there would make the panel impossible to keep up
    // while reading past it — which is the whole point of it thinning as the
    // page moves. A scroll produces no click; a tap to dismiss does.
    const onClickOutside = (event) => {
      if (popoverRef.current?.contains(event.target)) return
      if (triggerRef.current?.contains(event.target)) return
      close()
    }

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      close({ restoreFocus: true })
    }

    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, isOpen])

  // Opening lands the keyboard on the section the reader is already in, which
  // is where they would have to arrow to anyway.
  useEffect(() => {
    if (!isOpen) return
    const current = popoverRef.current?.querySelector('[aria-current="location"]')
    current?.focus({ preventScroll: true })
  }, [isOpen])

  const selectSection = (event, id) => {
    event.preventDefault()
    close()

    // The rail's link, not a reimplementation of it: StaticPage listens on the
    // rail for exactly this click and owns the navigation that follows.
    const railLink = document.querySelector(`${RAIL_NAV_SELECTOR} a[href="#${CSS.escape(id)}"]`)
    if (railLink) {
      railLink.click()
      return
    }

    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  // A page with no rail — the homepage, the about page — has no position to
  // report, and a single-section article has none worth reporting.
  if (!isCompact || sections.length < 2) return null

  const state = [
    isVisible && 'is-visible',
    isOpen && 'is-open',
    isPageScrolling && 'is-page-scrolling',
    isOnFooter && 'is-on-footer',
  ].filter(Boolean).join(' ')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`reading-position ${state}`.trim()}
        aria-label={readingPositionLabel(sections, activeIndex)}
        aria-expanded={isOpen}
        aria-controls="reading-position-popover"
        aria-hidden={!isVisible}
        tabIndex={isVisible ? 0 : -1}
        onClick={() => (isOpen ? close({ restoreFocus: true }) : setIsOpen(true))}
      >
        <svg className="reading-position-glyph" viewBox="0 0 18 18" aria-hidden="true">
          <path className="reading-position-glyph-rules" d="M7 4h8M7 9h8M7 14h5" />
          {/* The rail indicator, at the scale of a 38px disc. Positioned from
              state rather than tweened: it moves when the section changes,
              which is rare, and CSS carries it the rest of the way. */}
          <rect
            className="reading-position-glyph-indicator"
            x="2"
            y={glyphIndicatorY(activeIndex, sections.length, GLYPH_BAR_HEIGHT)}
            width="2"
            height={GLYPH_BAR_HEIGHT}
            rx="1"
          />
        </svg>
      </button>

      {/* Kept mounted so it leaves along the path it arrived on, and held out
          of the accessibility tree and the tab order while closed. */}
      <nav
        ref={popoverRef}
        id="reading-position-popover"
        className={[
          'reading-position-popover',
          isOpen && 'is-open',
          isPageScrolling && 'is-page-scrolling',
          isOnFooter && 'is-on-footer',
        ].filter(Boolean).join(' ')}
        aria-label="Article sections"
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <p className="reading-position-heading">
          <span>On this page</span>
          <span className="reading-position-count">{activeIndex + 1} / {sections.length}</span>
        </p>
        {readTime && <p className="reading-position-readtime">{readTime}</p>}
        <ol className="reading-position-list">
          {sections.map((section, index) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={index === activeIndex ? 'location' : undefined}
                onClick={(event) => selectSection(event, section.id)}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
}
