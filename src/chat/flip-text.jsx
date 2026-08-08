import { useLayoutEffect, useRef } from 'react'
import { animate, cubicBezier, utils } from 'animejs'

const FLIP_DELAY_MS = 120
const FLIP_OUT_MS = 200
const FLIP_IN_MS = 280
const REDUCED_MOTION_MS = 120
const flipEase = cubicBezier(0.25, 0.1, 0.25, 1)
const fadeEase = cubicBezier(0.23, 1, 0.32, 1)

function renderGlyphs(element, value) {
  const glyphs = Array.from(value, (character) => {
    const glyph = document.createElement('span')
    glyph.className = 'site-flip-text-glyph'
    glyph.textContent = character
    return glyph
  })
  element.replaceChildren(...glyphs)
  return glyphs
}

// Adapted from Athena's FlipNumber primitive: accessible copy stays stable
// while a separate glyph surface owns the visual transition.
export function FlipText({ value }) {
  const glyphsRef = useRef(null)
  const displayedValueRef = useRef(value)
  const animationRef = useRef(null)

  useLayoutEffect(() => {
    const element = glyphsRef.current
    if (!element) return undefined

    const previousValue = displayedValueRef.current
    animationRef.current?.revert()
    animationRef.current = null

    if (previousValue === value) {
      if (!element.childElementCount) renderGlyphs(element, value)
      return undefined
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const outgoingGlyphs = element.childElementCount
      ? Array.from(element.children)
      : renderGlyphs(element, previousValue)

    if (reduceMotion) {
      displayedValueRef.current = value
      const incomingGlyphs = renderGlyphs(element, value)
      utils.set(incomingGlyphs, { opacity: 0 })
      animationRef.current = animate(incomingGlyphs, {
        duration: REDUCED_MOTION_MS,
        ease: fadeEase,
        opacity: 1,
        onComplete: () => {
          incomingGlyphs.forEach((glyph) => glyph.removeAttribute('style'))
          animationRef.current = null
        },
      })
      return () => animationRef.current?.revert()
    }

    animationRef.current = animate(outgoingGlyphs, {
      delay: FLIP_DELAY_MS,
      duration: FLIP_OUT_MS,
      ease: flipEase,
      opacity: 0,
      rotateX: '55deg',
      translateY: '-55%',
      onComplete: () => {
        displayedValueRef.current = value
        const incomingGlyphs = renderGlyphs(element, value)
        utils.set(incomingGlyphs, {
          opacity: 0,
          rotateX: '-55deg',
          translateY: '55%',
        })
        animationRef.current = animate(incomingGlyphs, {
          duration: FLIP_IN_MS,
          ease: flipEase,
          opacity: 1,
          rotateX: '0deg',
          translateY: '0%',
          onComplete: () => {
            incomingGlyphs.forEach((glyph) => glyph.removeAttribute('style'))
            animationRef.current = null
          },
        })
      },
    })

    return () => animationRef.current?.revert()
  }, [value])

  return (
    <span
      className="site-flip-text"
      data-motion="flip"
      data-transition-delay={FLIP_DELAY_MS}
      data-transition-duration={FLIP_DELAY_MS + FLIP_OUT_MS + FLIP_IN_MS}
      data-value={value}
    >
      <span className="visually-hidden">{value}</span>
      <span ref={glyphsRef} className="site-flip-text-glyphs" aria-hidden="true" />
    </span>
  )
}
