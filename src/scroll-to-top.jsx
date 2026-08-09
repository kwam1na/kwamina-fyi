import { useEffect, useRef, useState } from 'react'
import { animate, cubicBezier } from 'animejs'
import {
  computeScrollProgress,
  SCROLL_TO_TOP_REVEAL_PX,
  scrollToTopDurationMs,
} from './scroll-progress.js'
import { useFooterOverlap } from './use-footer-overlap.js'

// The site's own --ease-portfolio. Strong ease-out: it leaves immediately,
// which is the part of the travel the reader is watching, then settles.
const scrollEase = cubicBezier(0.23, 1, 0.32, 1)

// The ring's sweep advances in 1/60th-of-circumference steps — 2px of arc on
// a 19px radius. Any finer and a fast scroll writes every frame again, which
// is the regime that repainted the page (see the write below).
const RING_STEPS = 60

/**
 * Floating control that reports reading progress in its ring and returns the
 * reader to the top of the page. Ported from Athena's docs workspace.
 *
 * Scroll progress is written straight to the ring's `stroke-dashoffset` rather
 * than held in React state: it changes every frame, and re-rendering on each
 * one would be wasted work. Only the visibility boolean — which flips rarely —
 * goes through state, so focus handling stays declarative.
 */
export function ScrollToTop() {
  const buttonRef = useRef(null)
  const progressRef = useRef(null)
  const animationRef = useRef(null)
  const isVisibleRef = useRef(false)
  const ringStepRef = useRef(1)
  const [isVisible, setIsVisible] = useState(false)
  const isOnFooter = useFooterOverlap(buttonRef)

  useEffect(() => {
    let frame = 0

    const read = () => {
      frame = 0
      const root = document.documentElement
      const scrollTop = window.scrollY
      const progress = computeScrollProgress(scrollTop, root.scrollHeight, root.clientHeight)

      // Written only when the quantized step changes, never per frame. The
      // naive every-frame write made Chromium repaint the full scrolling
      // layer on every scrolled frame (profiled via CDP paint traces: ~220
      // full-document paints per scroll pass, collapsing to the baseline
      // ~65 once the writes stopped), which read as scroll jitter.
      const ring = progressRef.current
      const step = Math.round((1 - progress) * RING_STEPS) / RING_STEPS
      if (ring && step !== ringStepRef.current) {
        ringStepRef.current = step
        ring.style.strokeDashoffset = String(step)
      }

      const nextVisible = scrollTop > SCROLL_TO_TOP_REVEAL_PX
      if (nextVisible !== isVisibleRef.current) {
        isVisibleRef.current = nextVisible
        setIsVisible(nextVisible)
      }
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read)
    }

    read()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })

    // Page content swaps as the reader navigates, so the scrollable distance
    // changes without a scroll or resize event to announce it.
    const observer = 'ResizeObserver' in window ? new ResizeObserver(schedule) : null
    observer?.observe(document.body)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [])

  // Any real scroll input while the animation runs hands control straight back
  // to the reader instead of fighting them for the viewport.
  useEffect(() => {
    const cancel = () => {
      animationRef.current?.cancel()
      animationRef.current = null
    }

    const events = ['wheel', 'touchstart', 'pointerdown']
    events.forEach((event) => window.addEventListener(event, cancel, { passive: true }))

    return () => {
      events.forEach((event) => window.removeEventListener(event, cancel))
      cancel()
    }
  }, [])

  const handleClick = () => {
    const from = window.scrollY
    if (from <= 0) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo(0, 0)
      return
    }

    animationRef.current?.cancel()
    // Animating a plain object and writing each frame to the scroll position
    // keeps the travel interruptible; `scroll-behavior: smooth` could not be
    // cancelled partway.
    const state = { y: from }
    animationRef.current = animate(state, {
      y: 0,
      duration: scrollToTopDurationMs(from),
      ease: scrollEase,
      onUpdate: () => window.scrollTo(0, state.y),
      onComplete: () => {
        animationRef.current = null
      },
    })
  }

  return (
    <button
      ref={buttonRef}
      className={`scroll-top${isVisible ? ' is-visible' : ''}${isOnFooter ? ' is-on-footer' : ''}`}
      type="button"
      aria-label="Scroll to top"
      aria-hidden={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      onClick={handleClick}
    >
      <svg className="scroll-top-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
        <circle className="scroll-top-track" cx="22" cy="22" r="19" fill="none" strokeWidth="2" />
        <circle
          ref={progressRef}
          className="scroll-top-progress"
          cx="22"
          cy="22"
          r="19"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={1}
          strokeDashoffset={1}
        />
      </svg>
      <svg className="scroll-top-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
      </svg>
    </button>
  )
}
