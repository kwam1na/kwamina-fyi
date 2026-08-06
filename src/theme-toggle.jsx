import { useEffect, useRef, useState } from 'react'
import { useFooterOverlap } from './use-footer-overlap.js'

const storageKey = 'kwamina-fyi-theme'

function getTheme() {
  const savedTheme = window.localStorage.getItem(storageKey)
  if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(getTheme)
  const [isVisible, setIsVisible] = useState(false)
  const toggleRef = useRef(null)
  const isOnFooter = useFooterOverlap(toggleRef)
  const isDark = theme === 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(storageKey, theme)
  }, [theme])

  useEffect(() => {
    let frame = 0

    const updateVisibility = () => {
      frame = 0
      const nav = document.querySelector('.site-nav')
      const navIsSticky = nav && window.getComputedStyle(nav).position === 'sticky'
      setIsVisible(
        nav
          ? navIsSticky
            ? window.scrollY >= nav.offsetHeight
            : nav.getBoundingClientRect().bottom <= 0
          : window.scrollY > 0,
      )
    }

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateVisibility)
    }

    const pageObserver = new MutationObserver(scheduleUpdate)
    pageObserver.observe(document.getElementById('root'), { childList: true, subtree: true })
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()

    return () => {
      window.cancelAnimationFrame(frame)
      pageObserver.disconnect()
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [])

  return (
    <button
      ref={toggleRef}
      className={`theme-toggle${isVisible ? ' is-visible' : ''}${isOnFooter ? ' is-on-footer' : ''}`}
      type="button"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <svg className="theme-toggle-icon theme-toggle-icon--sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.72 5.28l-1.42 1.42M6.7 17.3l-1.42 1.42M18.72 18.72l-1.42-1.42M6.7 6.7L5.28 5.28" />
      </svg>
      <svg className="theme-toggle-icon theme-toggle-icon--moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.3 14.7A8.5 8.5 0 0 1 9.3 3.7 8.5 8.5 0 1 0 20.3 14.7Z" />
      </svg>
    </button>
  )
}
