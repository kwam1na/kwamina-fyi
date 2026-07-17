import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'

const routePaths = new Set([
  '/',
  '/work/athena',
  '/work/athena/local-first-pos',
  '/work/athena/agent-ready-repository',
])

function normalisePath(pathname) {
  if (pathname === '/homepage-draft-v1.html') return '/'
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
}

// The homepage's scroll position is remembered when leaving via an in-site
// link, so returning brings the reader back to where they were (e.g. the
// Athena section). Homepage-only; other pages always open at the top.
// Deliberately in-memory: a fresh page load starts at the top as before.
const scrollRestorePaths = new Set(['/'])
const savedScrollPositions = new Map()

function extractPage(documentHtml) {
  const styles = [...documentHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join('\n')
  const body = documentHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? documentHtml

  return {
    styles,
    body: body.replace(/<script\b[\s\S]*?<\/script>/gi, ''),
  }
}

export function StaticPage({ documentHtml, pagePath, title }) {
  const containerRef = useRef(null)
  const navigate = useNavigate()
  const page = useMemo(() => extractPage(documentHtml), [documentHtml])

  useLayoutEffect(() => {
    const savedPosition = savedScrollPositions.get(pagePath)
    savedScrollPositions.delete(pagePath)
    window.scrollTo(0, savedPosition ?? 0)
  }, [pagePath])

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    const operatingFlow = containerRef.current?.querySelector('.operating-flow')
    if (!operatingFlow || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    operatingFlow.classList.add('has-flow-motion')

    if (!('IntersectionObserver' in window)) {
      operatingFlow.classList.add('is-flowing')
      return undefined
    }

    const observer = new IntersectionObserver(([entry]) => {
      operatingFlow.classList.toggle('is-flowing', entry.isIntersecting)
    }, { threshold: 0.35 })

    observer.observe(operatingFlow)
    return () => observer.disconnect()
  }, [documentHtml])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const onClick = (event) => {
      const link = event.target.closest('a[href]')
      if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const href = link.getAttribute('href')
      if (!href || href.startsWith('#') || link.target) return

      const target = new URL(href, new URL(pagePath, window.location.origin))
      const path = normalisePath(target.pathname)
      if (target.origin !== window.location.origin || !routePaths.has(path)) return

      const destinationHash = target.hash

      event.preventDefault()
      if (scrollRestorePaths.has(pagePath)) savedScrollPositions.set(pagePath, window.scrollY)
      // Links marked data-scroll-top always land at the top of their
      // destination, discarding any saved position.
      if (link.hasAttribute('data-scroll-top')) savedScrollPositions.delete(path)
      navigate({
        to: path,
        hash: destinationHash.slice(1) || undefined,
        // The mount effect owns scroll (restore or top); keep the router
        // from resetting it after commit.
        resetScroll: false,
      })
    }

    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [navigate, pagePath])

  useEffect(() => {
    const nav = containerRef.current?.querySelector('.rail-nav[aria-label="On this page"]')
    if (!nav) return undefined

    const links = [...nav.querySelectorAll('a[href^="#"]')]
    const indicator = nav.querySelector('.rail-indicator')
    const sections = links.map((link) => document.getElementById(link.hash.slice(1))).filter(Boolean)
    let frame

    const setActiveLink = (activeLink) => {
      links.forEach((link) => {
        const active = link === activeLink
        link.toggleAttribute('aria-current', active)
        if (active) link.setAttribute('aria-current', 'location')
      })

      if (indicator && activeLink) {
        const offset = activeLink.offsetTop + (activeLink.offsetHeight - 16) / 2
        indicator.style.transform = `translate3d(0, ${offset}px, 0)`
        indicator.style.opacity = '1'
      }
    }

    const update = () => {
      const readingLine = window.innerHeight * 0.35
      let current = sections[0]
      sections.forEach((section) => {
        if (section.getBoundingClientRect().top <= readingLine) current = section
      })

      if (current) setActiveLink(links.find((link) => link.hash === `#${current.id}`))
    }

    const onScroll = () => {
      // A clicked link keeps focus, and :focus-within holds the rail at full
      // opacity. Once the page scrolls, release that focus so the rail
      // returns to its dimmed state; if nothing is focused, do nothing.
      if (nav.contains(document.activeElement)) document.activeElement.blur()
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(update)
    }

    const onRailClick = (event) => {
      const link = event.target.closest('a[href^="#"]')
      if (!link) return

      const sectionId = link.hash.slice(1)
      if (!document.getElementById(sectionId)) return

      event.preventDefault()
      navigate({
        to: normalisePath(window.location.pathname),
        hash: sectionId,
        resetScroll: false,
        hashScrollIntoView: false,
      }).then(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('hashchange', update)
    nav.addEventListener('click', onRailClick)
    update()
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('hashchange', update)
      nav.removeEventListener('click', onRailClick)
    }
  }, [documentHtml, navigate])

  return (
    <div key={pagePath} ref={containerRef} className="routed-page">
      {page.styles && <style>{page.styles}</style>}
      <div dangerouslySetInnerHTML={{ __html: page.body }} />
    </div>
  )
}
