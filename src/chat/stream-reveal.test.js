import { describe, expect, it } from 'bun:test'
import { revealDuration, revealedPrefix } from './stream-reveal.js'

describe('stream reveal', () => {
  it('keeps streaming catch-up brief and settles completed text faster', () => {
    expect(revealDuration(1, true)).toBe(70)
    expect(revealDuration(12, true)).toBe(120)
    expect(revealDuration(100, true)).toBe(180)
    expect(revealDuration(100, false)).toBe(120)
  })

  it('reveals whole Unicode code points and clamps the character boundary', () => {
    expect(revealedPrefix('A😀B', 2)).toBe('A😀')
    expect(revealedPrefix('A😀B', -1)).toBe('')
    expect(revealedPrefix('A😀B', 20)).toBe('A😀B')
  })
})
