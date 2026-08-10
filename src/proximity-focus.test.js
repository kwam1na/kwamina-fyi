import { describe, expect, it } from 'bun:test'
import {
  PROXIMITY_DEFAULTS,
  proximityNearness,
  proximityOptionsFrom,
  proximityValues,
  smoothstep,
} from './proximity-focus.js'

// A 100px-wide word: 100 * 3.2 = 320 is under the 420 floor, so the reach is
// 420px in every direction from the word's edges.
const word = { left: 500, right: 600, top: 200, bottom: 240, width: 100 }

describe('proximityNearness', () => {
  it('is full on the node itself, edges included', () => {
    expect(proximityNearness(word, 550, 220)).toBe(1)
    expect(proximityNearness(word, 500, 200)).toBe(1)
    expect(proximityNearness(word, 600, 240)).toBe(1)
  })

  it('falls off linearly from the nearest edge, not the centre', () => {
    // 210px past the right edge is half of the 420px reach. The pointer is
    // 260px from the centre, which would read differently.
    expect(proximityNearness(word, 810, 220)).toBeCloseTo(0.5, 5)
    // The same distance to the left of the word reads the same.
    expect(proximityNearness(word, 290, 220)).toBeCloseTo(0.5, 5)
  })

  it('measures diagonally when the pointer is off both axes', () => {
    // 3-4-5: 252 right and 336 below is 420 away — exactly out of reach.
    expect(proximityNearness(word, 852, 576)).toBeCloseTo(0, 5)
  })

  it('reports 0 beyond the reach rather than going negative', () => {
    expect(proximityNearness(word, 5000, 220)).toBe(0)
    expect(proximityNearness(word, 550, -5000)).toBe(0)
  })

  it('scales the reach off a wide node so the falloff holds at any size', () => {
    // 400 wide clears the floor: 400 * 3.2 = 1280.
    const headline = { left: 0, right: 400, top: 0, bottom: 60, width: 400 }
    // 640px past the right edge is half of that reach.
    expect(proximityNearness(headline, 1040, 30)).toBeCloseTo(0.5, 5)
  })

  it('takes a tighter reach when a section asks for one', () => {
    const tight = { radiusScale: 1, minRadius: 100 }
    expect(proximityNearness(word, 650, 220, tight)).toBeCloseTo(0.5, 5)
  })
})

describe('smoothstep', () => {
  it('pins the ends and passes through the middle', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(0.5)).toBe(0.5)
    expect(smoothstep(1)).toBe(1)
  })

  it('eases in at the far edge', () => {
    expect(smoothstep(0.2)).toBeLessThan(0.2)
    expect(smoothstep(0.8)).toBeGreaterThan(0.8)
  })

  it('clamps out-of-range input instead of overshooting', () => {
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
  })
})

describe('proximityValues', () => {
  it('gives both responses full strength on the node', () => {
    const { focus, rule } = proximityValues(word, 550, 220)
    expect(focus).toBe(1)
    expect(rule).toBe(1)
  })

  it('leaves no ink at rest', () => {
    const { focus, rule } = proximityValues(word, 5000, 5000)
    expect(focus).toBe(0)
    expect(rule).toBe(0)
  })

  it('starts dimming before it starts drawing', () => {
    // Just inside the reach: under the rule's commitment threshold.
    const approaching = proximityValues(word, 600 + 420 * 0.9, 220)
    expect(approaching.focus).toBeGreaterThan(0)
    expect(approaching.rule).toBe(0)
  })

  it('keeps the rule behind the dimming, and closes the gap on approach', () => {
    // The rule is the same curve started late, so it trails the dimming the
    // whole way — but it climbs faster, so the gap narrows as the reader
    // closes in rather than widening into a permanently half-drawn rule.
    const far = proximityValues(word, 600 + 420 * 0.6, 220)
    const near = proximityValues(word, 600 + 420 * 0.2, 220)
    expect(far.rule).toBeLessThan(far.focus)
    expect(near.rule).toBeLessThan(near.focus)
    expect(near.focus - near.rule).toBeLessThan(far.focus - far.rule)
  })

  it('honours a section that wants the rule to start at once', () => {
    const eager = proximityValues(word, 600 + 420 * 0.9, 220, { ruleThreshold: 0 })
    expect(eager.rule).toBeGreaterThan(0)
  })
})

describe('a scope with more than one focus', () => {
  // The scope recedes for whichever focus is closest, so the section pulls
  // back once for the one thing being reached for rather than twice.
  const nearestOf = (rects, x, y) => Math.max(
    ...rects.map((rect) => proximityValues(rect, x, y).focus),
  )

  const name = { left: 100, right: 300, top: 0, bottom: 60, width: 200 }
  const phrase = { left: 100, right: 700, top: 200, bottom: 260, width: 600 }

  it('recedes on the nearer of the two, not the average', () => {
    // Sitting on the name: full recede, regardless of the phrase below.
    expect(nearestOf([name, phrase], 200, 30)).toBe(1)
    // Sitting on the phrase: likewise.
    expect(nearestOf([name, phrase], 400, 230)).toBe(1)
  })

  it('still relaxes when the pointer is clear of both', () => {
    expect(nearestOf([name, phrase], 100, 4000)).toBe(0)
  })

  it('gives each focus its own rule, so only one inks in', () => {
    // On the name, the phrase is 140px below the name's bottom edge — inside
    // its reach, but nowhere near committed.
    const onTheName = proximityValues(name, 200, 30)
    const thePhraseMeanwhile = proximityValues(phrase, 200, 30)
    expect(onTheName.rule).toBe(1)
    expect(thePhraseMeanwhile.rule).toBeLessThan(onTheName.rule)
  })
})

describe('proximityOptionsFrom', () => {
  it('falls back to the defaults for an undecorated scope', () => {
    expect(proximityOptionsFrom({})).toEqual(PROXIMITY_DEFAULTS)
  })

  it('reads the overrides a scope declares in its markup', () => {
    expect(proximityOptionsFrom({
      proximityRadiusScale: '1.5',
      proximityMinRadius: '200',
      proximityRuleThreshold: '0',
    })).toEqual({ radiusScale: 1.5, minRadius: 200, ruleThreshold: 0 })
  })

  it('ignores an unparseable attribute rather than poisoning the maths', () => {
    expect(proximityOptionsFrom({ proximityMinRadius: 'wide' }).minRadius)
      .toBe(PROXIMITY_DEFAULTS.minRadius)
  })
})
