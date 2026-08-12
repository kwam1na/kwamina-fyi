import React, { lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router'
import { StaticPage } from './static-page.jsx'
import { ThemeToggle } from './theme-toggle.jsx'
import { ScrollToTop } from './scroll-to-top.jsx'
import { ChatWidget } from './chat/chat-widget.jsx'
import { NotFoundPage } from './not-found-page.jsx'
import { ErrorPage } from './error-page.jsx'
import { startBrowserObservability } from './observability/browser.js'
import { observeCoreWebVitals, startManualAnalytics } from './observability/analytics.js'
import { createSimpleAnalyticsProvider } from './observability/simple-analytics.js'
import { installStaleAssetRecovery } from './stale-asset-recovery.js'
import {
  LEGACY_REDIRECTS,
  PRIVATE_ROUTE_PATHS,
  ROUTE_PATHS,
  isConversationArchiveRouteEnabled,
  shouldRenderSiteChrome,
} from './routes.js'
import homepage from '../docs/content/homepage.html?raw'
import about from '../docs/content/about.html?raw'
import athena from '../docs/content/work/athena/index.html?raw'
import localFirstPos from '../docs/content/work/athena/local-first-pos/index.html?raw'
import agentReadyRepository from '../docs/content/work/athena/agent-ready-repository/index.html?raw'
import readOptimizedReporting from '../docs/content/work/athena/read-optimized-reporting/index.html?raw'
import './styles.css'

function SentryTestButton() {
  return (
    <button
      onClick={() => {
        throw new Error('Controlled Sentry browser verification')
      }}
    >
      Break the world
    </button>
  )
}

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const showSiteChrome = shouldRenderSiteChrome(pathname, conversationArchiveRouteEnabled)

  return (
    <>
      <Outlet />
      {showSiteChrome && (
        <>
          <ThemeToggle />
          <ScrollToTop />
          <ChatWidget />
          {conversationArchiveRouteEnabled && <SentryTestButton />}
        </>
      )}
    </>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
})

const conversationArchiveRouteEnabled = isConversationArchiveRouteEnabled({
  isDevelopment: import.meta.env.DEV,
  enabled: import.meta.env.VITE_CONVERSATION_ARCHIVE_ENABLED === 'true',
  hostname: window.location.hostname,
  archiveHostname: import.meta.env.VITE_CONVERSATION_ARCHIVE_HOSTNAME,
})

function SitePage(props) {
  return <StaticPage {...props} conversationArchiveEntry={conversationArchiveRouteEnabled} />
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.home,
  component: () => <SitePage documentHtml={homepage} pagePath="/" title="Kwamina Essuah Mensah" />,
})

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.about,
  component: () => <SitePage documentHtml={about} pagePath="/about" title="About — Kwamina Essuah Mensah" />,
})

const athenaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.athena,
  component: () => <SitePage documentHtml={athena} pagePath="/work/athena/" title="Athena — Kwamina Essuah Mensah" />,
})

const localFirstPosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.localFirstPos,
  component: () => <SitePage documentHtml={localFirstPos} pagePath="/work/athena/local-first-pos/" title="Local-first point of sale — Athena" />,
})

const agentReadyRepositoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.agentReadyRepository,
  component: () => <SitePage documentHtml={agentReadyRepository} pagePath="/work/athena/agent-ready-repository/" title="Agent-ready repository — Athena" />,
})

const readOptimizedReportingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.readOptimizedReporting,
  component: () => <SitePage documentHtml={readOptimizedReporting} pagePath="/work/athena/read-optimized-reporting/" title="Read-optimized reporting — Athena" />,
})

const ConversationsPage = conversationArchiveRouteEnabled
  ? lazy(() => import('./conversations-page.jsx'))
  : null

const conversationsRoute = ConversationsPage && createRoute({
  getParentRoute: () => rootRoute,
  path: PRIVATE_ROUTE_PATHS.conversations,
  component: ConversationsPage,
})

const legacyRedirectRoutes = Object.entries(LEGACY_REDIRECTS).map(([from, to]) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: from,
    beforeLoad: () => {
      throw redirect({ to })
    },
  }),
)

const routeTree = rootRoute.addChildren([
  homeRoute,
  aboutRoute,
  athenaRoute,
  localFirstPosRoute,
  agentReadyRepositoryRoute,
  readOptimizedReportingRoute,
  ...(conversationsRoute ? [conversationsRoute] : []),
  ...legacyRedirectRoutes,
])

const router = createRouter({
  routeTree,
  // Every route without its own error handling falls back to the site's own
  // error page rather than the router's built-in stack trace.
  defaultErrorComponent: ErrorPage,
})

installStaleAssetRecovery()

startBrowserObservability({
  environment: import.meta.env.PROD ? 'production' : 'local',
  providerReady: __OBSERVABILITY_PROVIDER_READY__,
  dsn: __SENTRY_BROWSER_DSN__,
  release: __APP_RELEASE__,
})

startManualAnalytics({
  router,
  provider: createSimpleAnalyticsProvider({ target: window }),
  providerReady: import.meta.env.VITE_SIMPLE_ANALYTICS_READY === 'true',
  environment: import.meta.env.PROD ? 'production' : 'local',
  target: window,
  observeVitals: observeCoreWebVitals,
})

createRoot(document.getElementById('root')).render(<RouterProvider router={router} />)
