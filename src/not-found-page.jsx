import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { NoticeArrow, NoticeLayout } from './notice-page.jsx'

export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found — Kwamina Essuah Mensah'
  }, [])

  return (
    <NoticeLayout className="not-found-page" volume="Vol. 404" filedUnder="missing">
      <div className="notice-display not-found-display" aria-hidden="true">
        <span>4</span>
        <span className="not-found-zero">0</span>
        <span>4</span>
      </div>

      <div className="notice-copy">
        <p className="notice-kicker">Error 404</p>
        <h1>This page isn’t in the edition.</h1>
        <p className="notice-note">
          It may have moved, or the link may have outlived its subject.
        </p>
      </div>

      <nav className="notice-actions" aria-label="Continue browsing">
        <Link className="notice-action notice-action--primary" to="/">
          Return home
          <NoticeArrow />
        </Link>
      </nav>
    </NoticeLayout>
  )
}
