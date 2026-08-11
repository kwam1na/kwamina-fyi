import { describe, expect, it } from 'bun:test'
import { isConversationArchiveRouteEnabled } from './routes.js'

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
})
