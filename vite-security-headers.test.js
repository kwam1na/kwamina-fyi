import { describe, expect, it } from 'bun:test'
import {
  contentSecurityPolicy,
  inlineScriptHashes,
  providerOrigin,
  securityHeadersFile,
} from './vite-security-headers.js'
import { SIMPLE_ANALYTICS_ENDPOINT } from './src/observability/simple-analytics.js'

const directive = (policy, name) =>
  policy.split('; ').find((entry) => entry.startsWith(`${name} `)) ?? ''

describe('static asset security headers', () => {
  it('hashes inline script bodies and ignores scripts loaded from the site', () => {
    const hashes = inlineScriptHashes(`
      <script>document.documentElement.dataset.theme = 'dark'</script>
      <script type="module" src="/assets/main.js"></script>
      <script src="/assets/other.js" defer></script>
    `)

    expect(hashes).toHaveLength(1)
    expect(hashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/)
  })

  it('tracks the script body exactly, so an edited script cannot keep a stale hash', () => {
    const before = inlineScriptHashes('<script>const a = 1</script>')
    const after = inlineScriptHashes('<script>const a = 2</script>')

    expect(before).not.toEqual(after)
  })

  it('skips empty scripts and collapses duplicates', () => {
    expect(inlineScriptHashes('<script></script><script>  </script>')).toEqual([])
    expect(inlineScriptHashes('<script>same()</script><script>same()</script>')).toHaveLength(1)
  })

  it('reduces a credential-bearing DSN to a bare origin', () => {
    expect(providerOrigin('https://public@o1.ingest.sentry.io/42')).toBe('https://o1.ingest.sentry.io')
    expect(providerOrigin('')).toBe('')
    expect(providerOrigin('not-a-url')).toBe('')
  })

  it('admits the script hash and refuses inline script by omission', () => {
    const policy = contentSecurityPolicy({ scriptHashes: ["'sha256-abc123'"] })

    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'sha256-abc123'")
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("base-uri 'self'")
  })

  it('permits exactly the origins the site loads and sends to', () => {
    const policy = contentSecurityPolicy({ browserDsn: 'https://public@o1.ingest.sentry.io/42' })

    expect(directive(policy, 'connect-src'))
      .toBe(`connect-src 'self' ${providerOrigin(SIMPLE_ANALYTICS_ENDPOINT)} https://o1.ingest.sentry.io`)
    expect(directive(policy, 'font-src')).toBe("font-src 'self' https://fonts.gstatic.com")
    expect(directive(policy, 'style-src')).toContain('https://fonts.googleapis.com')
    expect(directive(policy, 'media-src')).toBe("media-src 'self'")
  })

  it('names no reporting origin when the provider is not configured', () => {
    const policy = contentSecurityPolicy({})

    expect(directive(policy, 'connect-src')).toBe(`connect-src 'self' ${providerOrigin(SIMPLE_ANALYTICS_ENDPOINT)}`)
    expect(policy).not.toContain('sentry')
  })

  it('writes one Cloudflare rule covering every path', () => {
    const file = securityHeadersFile(contentSecurityPolicy({ scriptHashes: ["'sha256-abc123'"] }))
    const [comment, pattern, ...headers] = file.trimEnd().split('\n')

    expect(comment.startsWith('#')).toBe(true)
    expect(pattern).toBe('/*')
    for (const header of headers) {
      expect(header).toMatch(/^ {2}[A-Za-z-]+: \S/)
    }
    expect(file).toContain('  X-Content-Type-Options: nosniff')
    expect(file).toContain('  Referrer-Policy: no-referrer')
    expect(file).toContain('  Strict-Transport-Security: max-age=31536000')
    expect(file).toContain('  X-Frame-Options: DENY')
  })
})
