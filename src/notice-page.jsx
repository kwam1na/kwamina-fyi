import { Link } from '@tanstack/react-router'

// The chrome the two dead-end pages share — a missing route and a thrown
// error. Both sit outside the authored HTML the rest of the site renders, so
// they build their own nav rather than inheriting one, and both open on the
// same folio rule. What differs is the display mark and the copy beneath it,
// which each page supplies as children.

export function NoticeArrow({ className = 'notice-link-icon' }) {
  return (
    <svg
      className={className}
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

// The retry action's counterpart to the arrow: same 24-unit grid, same stroke
// weight and round caps, and drawn to roughly the arrow's footprint inside
// that grid rather than filling it — a full-width circle next to the arrow's
// short diagonal reads as the heavier of the two at the same box size.
export function NoticeReload() {
  return (
    <svg
      className="notice-link-icon notice-reload-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 12a6 6 0 1 1-1.76-4.24" />
      <path d="M18 6v3.4h-3.4" />
    </svg>
  )
}

export function NoticeLayout({ className, volume, filedUnder, children }) {
  return (
    <div className={`routed-page notice-page ${className}`}>
      <a className="skip-link" href="#main">Skip to content</a>

      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="brand" to="/">kwamina.fyi</Link>
        <Link className="nav-link" to="/about">About</Link>
      </nav>

      <main id="main" className="notice-main">
        <div className="notice-folio" aria-hidden="true">
          <span>{volume}</span>
          <span>Filed under: {filedUnder}</span>
        </div>

        {children}
      </main>
    </div>
  )
}
