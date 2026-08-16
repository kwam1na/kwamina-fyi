import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import {
  LEGACY_REDIRECTS,
  ROUTE_PATHS,
  isConversationArchiveRouteEnabled,
  shouldRenderChatTrigger,
  shouldRenderSiteChrome,
} from './routes.js'

describe('conversation archive route boundary', () => {
  it('uses the lesson-led canonical path without retaining the old article slug', () => {
    expect(ROUTE_PATHS.ifItMattersMakeItAGate)
      .toBe('/work/athena/if-it-matters-make-it-a-gate')
    expect(Object.values(ROUTE_PATHS)).not.toContain('/work/athena/prose-not-policy')
    expect(LEGACY_REDIRECTS).not.toHaveProperty('/work/athena/prose-not-policy')
  })

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
    expect(source).toContain('shouldRenderChatTrigger(state.matches)')
    expect(source).toContain('{showSiteChrome && (')
    expect(source).toContain('{showChatTrigger && <ChatWidget />}')
  })

  it('hides the chat trigger when routing lands on a 404 or error boundary', () => {
    expect(shouldRenderChatTrigger([{ status: 'success' }])).toBe(true)
    expect(shouldRenderChatTrigger([{ status: 'pending' }])).toBe(true)
    expect(shouldRenderChatTrigger([{ status: 'error' }])).toBe(false)
    expect(shouldRenderChatTrigger([{ status: 'notFound' }])).toBe(false)
    expect(shouldRenderChatTrigger([{ status: 'success', globalNotFound: true }])).toBe(false)
  })
})
