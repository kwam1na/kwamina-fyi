import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { addConversationArchiveEntry } from './admin-navigation.js'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

const navigation = `
  <nav class="site-nav" aria-label="Primary navigation">
    <a class="brand" href="/">kwamina.fyi</a>
    <a class="nav-link" href="/about">About</a>
  </nav>
`

describe('addConversationArchiveEntry', () => {
  it('adds a conversations entry to the primary navigation when enabled', () => {
    const result = addConversationArchiveEntry(navigation, true)

    expect(result).toContain('class="nav-link admin-nav-entry"')
    expect(result).toContain('href="/conversations"')
    expect(result).toContain('>CONVERSATIONS</a>')
    expect(result.indexOf('About')).toBeLessThan(result.indexOf('CONVERSATIONS'))
  })

  it('leaves public navigation unchanged when disabled', () => {
    expect(addConversationArchiveEntry(navigation, false)).toBe(navigation)
  })

  it('does not add a duplicate conversations entry', () => {
    const once = addConversationArchiveEntry(navigation, true)
    const twice = addConversationArchiveEntry(once, true)

    expect(twice.match(/href="\/conversations"/g)).toHaveLength(1)
  })

  it('keeps the injected entry on the shared navigation typography', () => {
    expect(styles).toMatch(/\.admin-nav-entry\s*{[^}]*font-size:\s*0\.8rem;/s)
    expect(styles).toMatch(/\.admin-nav-entry\s*{[^}]*text-transform:\s*uppercase;/s)
  })
})
