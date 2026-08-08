import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
} from '@tanstack/react-router'
import { StaticPage } from './static-page.jsx'
import { ThemeToggle } from './theme-toggle.jsx'
import { ScrollToTop } from './scroll-to-top.jsx'
import { ChatWidget } from './chat/chat-widget.jsx'
import { NotFoundPage } from './not-found-page.jsx'
import { ErrorPage } from './error-page.jsx'
import { LEGACY_REDIRECTS, ROUTE_PATHS } from './routes.js'
import homepage from '../docs/content/homepage.html?raw'
import about from '../docs/content/about.html?raw'
import athena from '../docs/content/work/athena/index.html?raw'
import localFirstPos from '../docs/content/work/athena/local-first-pos/index.html?raw'
import agentReadyRepository from '../docs/content/work/athena/agent-ready-repository/index.html?raw'
import readOptimizedReporting from '../docs/content/work/athena/read-optimized-reporting/index.html?raw'
import './styles.css'

function RootLayout() {
  return (
    <>
      <Outlet />
      <ThemeToggle />
      <ScrollToTop />
      <ChatWidget />
    </>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.home,
  component: () => <StaticPage documentHtml={homepage} pagePath="/" title="Kwamina Essuah Mensah" />,
})

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.about,
  component: () => <StaticPage documentHtml={about} pagePath="/about" title="About — Kwamina Essuah Mensah" />,
})

const athenaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.athena,
  component: () => <StaticPage documentHtml={athena} pagePath="/work/athena/" title="Athena — Kwamina Essuah Mensah" />,
})

const localFirstPosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.localFirstPos,
  component: () => <StaticPage documentHtml={localFirstPos} pagePath="/work/athena/local-first-pos/" title="Local-first point of sale — Athena" />,
})

const agentReadyRepositoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.agentReadyRepository,
  component: () => <StaticPage documentHtml={agentReadyRepository} pagePath="/work/athena/agent-ready-repository/" title="Agent-ready repository — Athena" />,
})

const readOptimizedReportingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTE_PATHS.readOptimizedReporting,
  component: () => <StaticPage documentHtml={readOptimizedReporting} pagePath="/work/athena/read-optimized-reporting/" title="Read-optimized reporting — Athena" />,
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
  ...legacyRedirectRoutes,
])

const router = createRouter({
  routeTree,
  // Every route without its own error handling falls back to the site's own
  // error page rather than the router's built-in stack trace.
  defaultErrorComponent: ErrorPage,
})

createRoot(document.getElementById('root')).render(<RouterProvider router={router} />)
