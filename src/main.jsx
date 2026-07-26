import React from 'react'
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
import homepage from '../docs/content/homepage-draft-v1.html?raw'
import about from '../docs/content/about.html?raw'
import athena from '../docs/content/work/athena/index.html?raw'
import localFirstPos from '../docs/content/work/athena/local-first-pos/index.html?raw'
import agentReadyRepository from '../docs/content/work/athena/agent-ready-repository/index.html?raw'
import './styles.css'

function RootLayout() {
  return (
    <>
      <Outlet />
      <ThemeToggle />
    </>
  )
}

const rootRoute = createRootRoute({ component: RootLayout })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <StaticPage documentHtml={homepage} pagePath="/" title="Kwamina Essuah Mensah" />,
})

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: () => <StaticPage documentHtml={about} pagePath="/about" title="About — Kwamina Essuah Mensah" />,
})

const athenaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work/athena',
  component: () => <StaticPage documentHtml={athena} pagePath="/work/athena/" title="Athena — Kwamina Essuah Mensah" />,
})

const localFirstPosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work/athena/local-first-pos',
  component: () => <StaticPage documentHtml={localFirstPos} pagePath="/work/athena/local-first-pos/" title="Local-first point of sale — Athena" />,
})

const agentReadyRepositoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work/athena/agent-ready-repository',
  component: () => <StaticPage documentHtml={agentReadyRepository} pagePath="/work/athena/agent-ready-repository/" title="Agent-ready repository — Athena" />,
})

const legacyLocalFirstPosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work/local-first-pos',
  beforeLoad: () => {
    throw redirect({ to: '/work/athena/local-first-pos' })
  },
})

const legacyAgentReadyRepositoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work/agent-ready-repository',
  beforeLoad: () => {
    throw redirect({ to: '/work/athena/agent-ready-repository' })
  },
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  aboutRoute,
  athenaRoute,
  localFirstPosRoute,
  agentReadyRepositoryRoute,
  legacyLocalFirstPosRoute,
  legacyAgentReadyRepositoryRoute,
])

const router = createRouter({
  routeTree,
})

createRoot(document.getElementById('root')).render(<RouterProvider router={router} />)
