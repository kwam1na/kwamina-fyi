import { describe, expect, it } from 'bun:test'
import { recordNavigation, returnLabels } from './return-stack.js'

const HOME = '/'
const ATHENA = '/work/athena'
const ARTICLE = '/work/athena/read-optimized-reporting'

// Walks a sequence of navigations through a fresh stack. Each step is
// [from, to] for a content link, or [from, to, 'return'] for a hero-return
// click, mirroring what the link interceptor passes in.
function walk(steps) {
  const stack = []
  for (const [from, to, via] of steps) {
    recordNavigation(stack, { from, to, viaReturnLink: via === 'return' })
  }
  return stack
}

// What the hero of the page you just landed on will display.
function backLinkOn(stack) {
  return returnLabels.get(stack[stack.length - 1]) ?? 'authored default'
}

describe('recordNavigation', () => {
  it('unwinds a chain in order, so each hero points one step back', () => {
    const homeToAthena = walk([[HOME, ATHENA]])
    expect(backLinkOn(homeToAthena)).toBe('Homepage')

    const thenToArticle = walk([
      [HOME, ATHENA],
      [ATHENA, ARTICLE],
    ])
    expect(backLinkOn(thenToArticle)).toBe('Athena')

    const backToAthena = walk([
      [HOME, ATHENA],
      [ATHENA, ARTICLE],
      [ARTICLE, ATHENA, 'return'],
    ])
    expect(backLinkOn(backToAthena)).toBe('Homepage')

    const backHome = walk([
      [HOME, ATHENA],
      [ATHENA, ARTICLE],
      [ARTICLE, ATHENA, 'return'],
      [ATHENA, HOME, 'return'],
    ])
    expect(backHome).toEqual([])
  })

  it('does not record the authored fallback when a reader arrives externally', () => {
    // Empty stack is an external arrival: the article shows its authored
    // "← Athena" fallback, which the reader never actually came from.
    const afterFollowingFallback = walk([[ARTICLE, ATHENA, 'return']])

    expect(afterFollowingFallback).toEqual([])
    // Regression guard: recording it here made Athena's hero point back at the
    // article, and the two pages then cycled with no route to the homepage.
    expect(backLinkOn(afterFollowingFallback)).not.toBe('Read-optimized reporting')
    expect(backLinkOn(afterFollowingFallback)).toBe('authored default')
  })

  it('cannot cycle between two pages no matter how often the return link is followed', () => {
    const stack = []
    const seen = []
    let here = ARTICLE

    for (let i = 0; i < 6; i += 1) {
      const there = here === ARTICLE ? ATHENA : ARTICLE
      recordNavigation(stack, { from: here, to: there, viaReturnLink: true })
      here = there
      seen.push(backLinkOn(stack))
    }

    // Every landing keeps its authored default, so the reader always has a
    // way up and out rather than being handed back where they just were.
    expect(seen).toEqual(Array(6).fill('authored default'))
    expect(stack).toEqual([])
  })

  it('still records a real content navigation between the same two pages', () => {
    // Reaching the story from the article's rail link is a genuine departure,
    // so returning to the article afterwards is correct.
    const stack = walk([[ARTICLE, ATHENA]])
    expect(backLinkOn(stack)).toBe('Read-optimized reporting')
  })

  it('treats reaching the recorded source as a return even without the return link', () => {
    const stack = walk([
      [HOME, ATHENA],
      [ATHENA, HOME],
    ])
    expect(stack).toEqual([])
  })
})
