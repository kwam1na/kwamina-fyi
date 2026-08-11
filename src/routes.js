// Canonical in-app route paths, shared by the router definition in main.jsx
// and the link interception in static-page.jsx.
//
// Both read from here on purpose. The content pages are authored HTML with
// real <a href> tags, and static-page.jsx upgrades a click to client-side
// navigation only when its destination is a known route. When that list was
// maintained separately, adding a page to the router and forgetting the
// interceptor degraded its in-content links to full page reloads: still
// correct, silently slower, and invisible in review.

export const ROUTE_PATHS = {
  home: '/',
  about: '/about',
  athena: '/work/athena',
  localFirstPos: '/work/athena/local-first-pos',
  agentReadyRepository: '/work/athena/agent-ready-repository',
  readOptimizedReporting: '/work/athena/read-optimized-reporting',
}

// Private tools are intentionally excluded from the public route and in-app
// navigation registries. The router adds them only in local development or on
// the exact production hostname configured for the private archive.
export const PRIVATE_ROUTE_PATHS = {
  conversations: '/conversations',
}

export function isConversationArchiveRouteEnabled({
  isDevelopment,
  enabled,
  hostname,
  archiveHostname,
}) {
  if (isDevelopment) return true
  return Boolean(enabled && archiveHostname && hostname === archiveHostname)
}

export function shouldRenderSiteChrome(pathname, archiveEnabled) {
  if (!archiveEnabled) return true
  return pathname !== PRIVATE_ROUTE_PATHS.conversations
    && !pathname.startsWith(`${PRIVATE_ROUTE_PATHS.conversations}/`)
}

// Superseded paths kept resolvable so older links and bookmarks still land.
export const LEGACY_REDIRECTS = {
  '/work/local-first-pos': ROUTE_PATHS.localFirstPos,
  '/work/agent-ready-repository': ROUTE_PATHS.agentReadyRepository,
}

// The destinations the interceptor handles in-app. Legacy paths are excluded:
// they resolve through a full load and the router's redirect, which keeps the
// canonical URL as the only one worth linking to from content.
export const NAVIGABLE_PATHS = new Set(Object.values(ROUTE_PATHS))

export function normalisePath(pathname) {
  if (pathname === '/homepage.html') return ROUTE_PATHS.home
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}
