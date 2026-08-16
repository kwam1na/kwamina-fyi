import { describe, expect, it } from 'bun:test'
import { chatPageLabelForPath, chatTitleForPath } from './chat-title.js'

describe('chatTitleForPath', () => {
  it('names the current content page', () => {
    expect(chatPageLabelForPath('/work/athena')).toBe('Athena')
    expect(chatTitleForPath('/work/athena')).toBe('Ask about Athena')
    expect(chatTitleForPath('/work/athena/agent-ready-repository'))
      .toBe('Ask about Agent-ready repository')
    expect(chatTitleForPath('/work/athena/if-it-matters-make-it-a-gate'))
      .toBe('Ask about If It Matters, Make It a Gate')
  })

  it('normalises trailing slashes and falls back to Kwamina', () => {
    expect(chatTitleForPath('/work/athena/local-first-pos/'))
      .toBe('Ask about Local-first point of sale')
    expect(chatTitleForPath('/work/athena/local-first-pos///'))
      .toBe('Ask about Local-first point of sale')
    expect(chatTitleForPath('/not-a-page')).toBe('Ask about Kwamina')
  })
})
