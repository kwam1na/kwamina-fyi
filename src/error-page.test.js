import { describe, expect, it } from 'bun:test'
import { reportRootRenderFailure } from './error-page.jsx'

describe('root render failure reporting', () => {
  it('uses root context without changing the error value', () => {
    const calls = []
    const error = new Error('private-root-message')

    reportRootRenderFailure(error, (...args) => calls.push(args))

    expect(calls).toEqual([[error, 'root_render']])
  })
})
