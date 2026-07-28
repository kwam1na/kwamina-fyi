import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'

function ArrowUpRight() {
  return (
    <svg
      className="not-found-link-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  )
}

export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found — Kwamina Essuah Mensah'
  }, [])

  return (
    <div className="routed-page not-found-page">
      <a className="skip-link" href="#main">Skip to content</a>

      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="brand" to="/">kwamina.fyi</Link>
        <Link className="nav-link" to="/about">About</Link>
      </nav>

      <main id="main" className="not-found-main">
        <div className="not-found-folio" aria-hidden="true">
          <span>Vol. 404</span>
          <span>Filed under: missing</span>
        </div>

        <div className="not-found-display" aria-hidden="true">
          <span>4</span>
          <span className="not-found-zero">0</span>
          <span>4</span>
        </div>

        <div className="not-found-copy">
          <p className="not-found-kicker">Error 404</p>
          <h1>This page isn’t in the edition.</h1>
          <p className="not-found-note">
            It may have moved, or the link may have outlived its subject.
          </p>
        </div>

        <nav className="not-found-actions" aria-label="Continue browsing">
          <Link className="not-found-action not-found-action--primary" to="/">
            Return home
            <ArrowUpRight />
          </Link>
        </nav>
      </main>
    </div>
  )
}
