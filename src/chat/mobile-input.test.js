import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

describe('mobile chat composer', () => {
  it('uses 16px text only at the existing mobile breakpoint', () => {
    expect(styles).toContain(`.site-chat-input {
  padding: 11px 13px 0;
  border: 0;
  background: none;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 0.85rem;`)
    expect(styles).toContain(`@media (max-width: 620px) {`)
    expect(styles).toContain(`  .site-chat-input {
    font-size: 1rem;
  }`)
  })
})
