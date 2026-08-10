import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { ErrorPage, reportRootRenderFailure } from './error-page.jsx'

describe('root render failure reporting', () => {
  it('uses root context without changing the error value', () => {
    const calls = []
    const error = new Error('private-root-message')

    reportRootRenderFailure(error, (...args) => calls.push(args))

    expect(calls).toEqual([[error, 'root_render']])
  })

  it('reports an actual route render failure through ErrorPage while keeping recovery UI', async () => {
    const captures = []
    const routeError = new Error('route render failed')
    const rootRoute = createRootRoute()
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    const previousDocument = globalThis.document
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    const previousConsoleError = console.error
    globalThis.document = { title: '' }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    console.error = () => {}

    let renderer
    try {
      await act(async () => {
        renderer = create(createElement(
          RouterContextProvider,
          { router },
          createElement(ErrorPage, {
            error: routeError,
            captureFailure: (...args) => captures.push(args),
          }),
        ))
      })

      expect(captures).toEqual([[routeError, 'root_render']])
      expect(renderer.root.findByType('h1').children).toEqual(['This page stopped short.'])
    } finally {
      await act(async () => renderer?.unmount())
      console.error = previousConsoleError
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
      globalThis.document = previousDocument
    }
  })
})
