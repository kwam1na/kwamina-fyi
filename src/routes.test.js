import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { isConversationArchiveRouteEnabled, shouldRenderSiteChrome } from './routes.js'

describe('conversation archive route boundary', () => {
  it('keeps the route local or on its exact private production hostname', () => {
    expect(isConversationArchiveRouteEnabled({ isDevelopment: true, hostname: 'localhost' })).toBe(true)
    expect(isConversationArchiveRouteEnabled({
      isDevelopment: false,
      enabled: true,
      hostname: 'admin.kwamina.fyi',
      archiveHostname: 'admin.kwamina.fyi',
    })).toBe(true)
    expect(isConversationArchiveRouteEnabled({
      isDevelopment: false,
      enabled: true,
      hostname: 'kwamina.fyi',
      archiveHostname: 'admin.kwamina.fyi',
    })).toBe(false)
    expect(isConversationArchiveRouteEnabled({
      isDevelopment: false,
      enabled: true,
      hostname: 'preview.kwamina-fyi.workers.dev',
      archiveHostname: 'admin.kwamina.fyi',
    })).toBe(false)
    expect(isConversationArchiveRouteEnabled({
      isDevelopment: false,
      enabled: false,
      hostname: 'admin.kwamina.fyi',
      archiveHostname: 'admin.kwamina.fyi',
    })).toBe(false)
    expect(isConversationArchiveRouteEnabled({
      isDevelopment: false,
      hostname: 'admin.kwamina.fyi',
      archiveHostname: 'admin.kwamina.fyi',
    })).toBe(false)
  })

  it('keeps site chrome off the private archive route', () => {
    expect(shouldRenderSiteChrome('/', true)).toBe(true)
    expect(shouldRenderSiteChrome('/about', true)).toBe(true)
    expect(shouldRenderSiteChrome('/conversations', true)).toBe(false)
    expect(shouldRenderSiteChrome('/conversations/thread-alpha', true)).toBe(false)
    expect(shouldRenderSiteChrome('/conversations', false)).toBe(true)
  })

  it('uses the route-aware chrome boundary in the root layout', () => {
    const source = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8')

    expect(source).toContain('shouldRenderSiteChrome(pathname, conversationArchiveRouteEnabled)')
    expect(source).toContain('{showSiteChrome && (')
    expect(source).toContain('<ChatWidget />')
  })
})
