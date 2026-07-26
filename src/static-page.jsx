import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'

const routePaths = new Set([
  '/',
  '/about',
  '/work/athena',
  '/work/athena/local-first-pos',
  '/work/athena/agent-ready-repository',
])

function normalisePath(pathname) {
  if (pathname === '/homepage-draft-v1.html') return '/'
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
}

function addRouteBreadcrumbs(body, pagePath) {
  const segments = normalisePath(pagePath).split('/').filter(Boolean)
  if (segments.length === 0) return body

  const crumbs = segments
    .map((segment, index) => {
      const label = segment.replaceAll('-', ' ')
      const current = index === segments.length - 1 ? ' aria-current="page"' : ''
      return `<span class="brand-crumb" style="--crumb-index: ${index}"${current}>/ ${label}</span>`
    })
    .join('')

  return body.replace(
    /(<a\b[^>]*class=["'][^"']*\bbrand\b[^"']*["'][^>]*>[\s\S]*?<\/a>)/i,
    `<p class="brand-group">$1${crumbs}</p>`,
  )
}

// The homepage's scroll position is remembered when leaving via an in-site
// link, so returning brings the reader back to where they were (e.g. the
// Athena section). Homepage-only; other pages always open at the top.
// Deliberately in-memory: a fresh page load starts at the top as before.
const scrollRestorePaths = new Set(['/'])
const savedScrollPositions = new Map()
let hasPlayedHomeNavEntry = false

// Pages whose footer sits pinned beneath the page: the content scrolls as one
// opaque layer above it, so the footer stays hidden until the reader reaches
// the very bottom and the page slides up off it.
const revealedFooterPaths = new Set(['/', '/about'])

// The article heroes' return link adapts to how the reader arrived: entering
// from the homepage points it back home, from the Athena story back there,
// and so on. Sources are kept as a stack so chains unwind in order — home →
// Athena → article returns to Athena, and Athena still returns home.
// Navigating to the stack's top counts as a return and pops it; any other
// navigation pushes the departing page. Direct loads keep the page's
// authored default. Deliberately in-memory, like the saved scroll positions.
const returnLabels = new Map([
  ['/', 'Homepage'],
  ['/about', 'About'],
  ['/work/athena', 'Athena'],
  ['/work/athena/local-first-pos', 'Local-first point of sale'],
  ['/work/athena/agent-ready-repository', 'Agent-ready repository'],
])
const returnStack = []

// Pinch-to-zoom scoped to the lightbox image, ported from Athena's landing
// lightbox. A CSS transform is driven on the image and the layer takes
// `touch-action: none`, so the browser never zooms the visual viewport —
// otherwise the page stays zoomed after the lightbox closes. Double-tap
// toggles zoom; one finger pans while zoomed.
function attachZoomGestures(layer, image) {
  const MAX_SCALE = 4
  const g = {
    scale: 1,
    tx: 0,
    ty: 0,
    startDist: 0,
    startScale: 1,
    startMidX: 0,
    startMidY: 0,
    startTx: 0,
    startTy: 0,
    panning: false,
    panStartX: 0,
    panStartY: 0,
    lastTap: 0,
    lastTapX: 0,
    lastTapY: 0,
  }

  const apply = (smooth = false) => {
    image.style.transition = smooth ? 'transform 200ms ease' : 'none'
    image.style.transform = `translate(${g.tx}px, ${g.ty}px) scale(${g.scale})`
  }

  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

  const beginPan = (touch) => {
    if (g.scale <= 1) return
    g.panning = true
    g.panStartX = touch.clientX - g.tx
    g.panStartY = touch.clientY - g.ty
  }

  const onStart = (event) => {
    if (event.touches.length === 2) {
      g.panning = false
      g.startDist = distance(event.touches[0], event.touches[1])
      g.startScale = g.scale
      g.startMidX = (event.touches[0].clientX + event.touches[1].clientX) / 2
      g.startMidY = (event.touches[0].clientY + event.touches[1].clientY) / 2
      g.startTx = g.tx
      g.startTy = g.ty
      return
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0]
      const now = Date.now()
      const isDoubleTap = now - g.lastTap < 300
        && Math.hypot(touch.clientX - g.lastTapX, touch.clientY - g.lastTapY) < 30
      if (isDoubleTap) {
        g.scale = g.scale > 1 ? 1 : 2.5
        g.tx = 0
        g.ty = 0
        apply(true)
        g.lastTap = 0
      } else {
        g.lastTap = now
        g.lastTapX = touch.clientX
        g.lastTapY = touch.clientY
      }
      beginPan(touch)
    }
  }

  const onMove = (event) => {
    if (event.touches.length === 2) {
      event.preventDefault()
      const dist = distance(event.touches[0], event.touches[1])
      const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2
      const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2
      g.scale = Math.min(MAX_SCALE, Math.max(1, g.startScale * (dist / g.startDist)))
      g.tx = g.startTx + (midX - g.startMidX)
      g.ty = g.startTy + (midY - g.startMidY)
      apply()
    } else if (event.touches.length === 1 && g.panning) {
      event.preventDefault()
      g.tx = event.touches[0].clientX - g.panStartX
      g.ty = event.touches[0].clientY - g.panStartY
      apply()
    }
  }

  const onEnd = (event) => {
    if (event.touches.length === 0) {
      g.panning = false
      if (g.scale <= 1.02) {
        g.scale = 1
        g.tx = 0
        g.ty = 0
        apply(true)
      }
    } else if (event.touches.length === 1) {
      // Dropping from a pinch to one finger: re-baseline the pan.
      beginPan(event.touches[0])
    }
  }

  layer.addEventListener('touchstart', onStart, { passive: false })
  layer.addEventListener('touchmove', onMove, { passive: false })
  layer.addEventListener('touchend', onEnd, { passive: false })
  layer.addEventListener('touchcancel', onEnd, { passive: false })

  return () => {
    layer.removeEventListener('touchstart', onStart)
    layer.removeEventListener('touchmove', onMove)
    layer.removeEventListener('touchend', onEnd)
    layer.removeEventListener('touchcancel', onEnd)
  }
}

function extractPage(documentHtml, pagePath) {
  const styles = [...documentHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join('\n')
  const body = documentHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? documentHtml

  return {
    styles,
    body: addRouteBreadcrumbs(body.replace(/<script\b[\s\S]*?<\/script>/gi, ''), pagePath),
  }
}

export function StaticPage({ documentHtml, pagePath, title }) {
  const containerRef = useRef(null)
  const navigate = useNavigate()
  const page = useMemo(() => extractPage(documentHtml, pagePath), [documentHtml, pagePath])
  const shouldPlayHomeNavEntry = pagePath === '/' && !hasPlayedHomeNavEntry

  useLayoutEffect(() => {
    const savedPosition = savedScrollPositions.get(pagePath)
    savedScrollPositions.delete(pagePath)
    window.scrollTo(0, savedPosition ?? 0)
    if (shouldPlayHomeNavEntry) hasPlayedHomeNavEntry = true
  }, [pagePath, shouldPlayHomeNavEntry])

  useEffect(() => {
    document.title = title
  }, [title])

  // The page reserves exactly the footer's height below it, so the pinned
  // footer is uncovered at the end of the scroll. The footer's height is
  // content- and viewport-dependent, so it is measured rather than assumed.
  useEffect(() => {
    const container = containerRef.current
    const footer = container?.querySelector('.site-footer')
    if (!footer || !revealedFooterPaths.has(pagePath)) return undefined

    container.classList.add('has-revealed-footer')

    const measure = () => {
      const height = footer.offsetHeight
      container.style.setProperty('--revealed-footer-height', `${height}px`)
      // Larger screens fall back to normal flow when the footer cannot fit.
      // Mobile keeps the reveal and scrolls an unusually tall footer inside
      // its viewport-sized layer.
      const isMobile = window.matchMedia('(max-width: 620px)').matches
      container.classList.toggle('has-inline-footer', !isMobile && height > window.innerHeight)
    }

    measure()
    window.addEventListener('resize', measure)

    const observer = 'ResizeObserver' in window ? new ResizeObserver(measure) : null
    observer?.observe(footer)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      container.classList.remove('has-revealed-footer', 'has-inline-footer')
    }
  }, [documentHtml, pagePath])

  useEffect(() => {
    const back = containerRef.current?.querySelector('.hero-return')
    const source = returnStack[returnStack.length - 1]
    const label = returnLabels.get(source)
    if (!back || !label) return

    back.setAttribute('href', source)
    back.setAttribute('aria-label', `Back to ${label}`)
    const labelEl = back.querySelector('.hero-return-label')
    if (labelEl) labelEl.textContent = label
  }, [documentHtml, pagePath])

  // The establishing gallery works like tabs: the strip shows every capture
  // as a thumbnail, and selecting one retargets the hero figure's images and
  // caption. Nothing moves in the DOM and the hero frame has a fixed aspect
  // ratio, so the reader's scroll position stays put.
  useEffect(() => {
    const section = containerRef.current?.querySelector('.product-establishing')
    const hero = section?.querySelector('.establishing-shot')
    const heroCaption = hero?.querySelector('.establishing-caption')
    if (!section || !hero || !heroCaption) return undefined

    const select = (thumb) => {
      const heroLight = hero.querySelector('.workspace-capture--light')
      const heroDark = hero.querySelector('.workspace-capture--dark')
      const thumbLight = thumb.querySelector('.workspace-capture--light')
      const thumbDark = thumb.querySelector('.workspace-capture--dark')

      heroLight.setAttribute('src', thumbLight.getAttribute('src'))
      heroDark.setAttribute('src', thumbDark.getAttribute('src'))
      heroLight.setAttribute('alt', thumb.dataset.heroAlt)
      heroDark.setAttribute('alt', thumb.dataset.heroAlt)
      heroCaption.textContent = thumb.dataset.heroCaption

      section.querySelectorAll('.shot-thumb').forEach((button) => {
        const active = button === thumb
        button.classList.toggle('is-active', active)
        button.setAttribute('aria-current', String(active))
      })
    }

    const onClick = (event) => {
      const thumb = event.target.closest('.shot-thumb')
      if (thumb && section.contains(thumb)) select(thumb)
    }

    section.addEventListener('click', onClick)
    return () => section.removeEventListener('click', onClick)
  }, [documentHtml])

  // Mobile-only lightbox for workspace captures, borrowed from Athena's
  // landing page: tapping a shot (or its expand affordance) opens it
  // full-screen where pinch and double-tap zoom the image. Body scroll locks
  // while open; Escape or a backdrop tap closes and returns focus to the
  // opener. Covers the establishing hero and any figure with a
  // .capture-frame wrapper.
  useEffect(() => {
    const container = containerRef.current
    const expandables = [...(container?.querySelectorAll('.establishing-shot, .capture-frame') ?? [])]
    if (!expandables.length) return undefined

    const mobile = window.matchMedia('(max-width: 768px)')
    let overlay = null
    let detachGestures = null
    let previousOverflow = ''
    let opener = null

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'Tab') {
        // The dialog holds no other focusable elements; keep focus on it.
        event.preventDefault()
        overlay?.focus()
      }
    }

    const close = () => {
      if (!overlay) return
      detachGestures?.()
      detachGestures = null
      overlay.remove()
      overlay = null
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      opener?.focus()
      opener = null
    }

    const open = (frame) => {
      if (overlay) return
      const dark = document.documentElement.dataset.theme === 'dark'
      const source = frame.querySelector(dark ? '.workspace-capture--dark' : '.workspace-capture--light')

      overlay = document.createElement('div')
      overlay.className = 'shot-lightbox'
      overlay.setAttribute('role', 'dialog')
      overlay.setAttribute('aria-modal', 'true')
      overlay.setAttribute('aria-label', source.getAttribute('alt'))
      overlay.tabIndex = -1

      const image = document.createElement('img')
      image.src = source.currentSrc || source.src
      image.alt = source.getAttribute('alt')
      overlay.appendChild(image)

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close()
      })

      document.body.appendChild(overlay)
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKeyDown)
      detachGestures = attachZoomGestures(overlay, image)
      overlay.focus()
    }

    const onContainerClick = (event) => {
      if (!mobile.matches) return
      const trigger = event.target.closest('.hero-expand') || event.target.closest('.workspace-capture')
      const frame = trigger && expandables.find((candidate) => candidate.contains(trigger))
      if (!frame) return
      opener = frame.querySelector('.hero-expand')
      open(frame)
    }

    // Resized out of the mobile range: a stale lightbox must not stay mounted.
    const onRangeChange = () => {
      if (!mobile.matches) close()
    }

    container.addEventListener('click', onContainerClick)
    mobile.addEventListener('change', onRangeChange)
    return () => {
      container.removeEventListener('click', onContainerClick)
      mobile.removeEventListener('change', onRangeChange)
      close()
    }
  }, [documentHtml])

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
      if (returnStack[returnStack.length - 1] === path) returnStack.pop()
      else returnStack.push(normalisePath(pagePath))
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
    <div
      key={pagePath}
      ref={containerRef}
      className={`routed-page${shouldPlayHomeNavEntry ? ' has-home-nav-entry' : ''}`}
    >
      {page.styles && <style>{page.styles}</style>}
      <div dangerouslySetInnerHTML={{ __html: page.body }} />
    </div>
  )
}
