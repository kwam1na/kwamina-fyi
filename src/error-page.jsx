import { useEffect } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { NoticeArrow, NoticeLayout, NoticeReload } from './notice-page.jsx'
import { captureBrowserRenderFailure } from './observability/browser.js'

export function reportRootRenderFailure(error, capture = captureBrowserRenderFailure) {
  capture(error, 'root_render')
}

// The page a thrown error lands on. It replaces the router's default error
// component, which is a bare browser-grey stack trace — the one screen on the
// site that looked like it belonged to a different site.
//
// Unlike the 404, this state is recoverable: the first exit re-runs the route
// that failed rather than sending the reader away from it.
export function ErrorPage({ error, reset, captureFailure = captureBrowserRenderFailure }) {
  const router = useRouter()

  useEffect(() => {
    document.title = 'Something went wrong — Kwamina Essuah Mensah'
  }, [])

  // The reader is shown a summary, not a stack. The console keeps the whole
  // thing so a real report is still one devtools panel away.
  useEffect(() => {
    console.error('Page error:', error)
    reportRootRenderFailure(error, captureFailure)
  }, [captureFailure, error])

  const retry = () => {
    reset?.()
    router.invalidate()
  }

  return (
    <NoticeLayout className="error-page" volume="Vol. —" filedUnder="interrupted">
      <div className="notice-display error-display" aria-hidden="true">Erratum</div>

      <div className="notice-copy">
        <p className="notice-kicker">Error</p>
        <h1>This page stopped short.</h1>
        <p className="notice-note">
          Something broke while it was rendering. Trying again often clears it;
          if it doesn’t, the rest of the site is still standing.
        </p>
        {error?.message && (
          <details className="error-detail">
            <summary>Technical detail</summary>
            <p>{error.message}</p>
          </details>
        )}
      </div>

      <nav className="notice-actions" aria-label="Recover">
        <button
          type="button"
          className="notice-action notice-action--primary"
          onClick={retry}
        >
          Try this page again
          <NoticeReload />
        </button>
        <Link className="notice-action" to="/">
          Return home
          <NoticeArrow />
        </Link>
      </nav>
    </NoticeLayout>
  )
}
