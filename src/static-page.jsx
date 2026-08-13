import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { animate, onScroll, remove, set, split, stagger } from 'animejs'
import { NAVIGABLE_PATHS, PRIVATE_ROUTE_PATHS, normalisePath } from './routes.js'
import { recordNavigation, returnLabels, returnStack } from './return-stack.js'
import { bindProximityScope, bindProximityScopes } from './proximity-focus.js'
import { addConversationArchiveEntry } from './admin-navigation.js'
import { readingLineFor } from './reading-position.js'

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

// The introduction reveals itself once per session, the same bargain the
// homepage's nav and headline entrances make. Scrolling back up to it, or
// returning to the homepage from a write-up, finds it already delivered —
// a line that re-introduces itself every time you pass stops being an
// introduction and becomes furniture.
let hasRevealedIntro = false

// Pages whose footer sits pinned beneath the page: the content scrolls as one
// opaque layer above it, so the footer stays hidden until the reader reaches
// the very bottom and the page slides up off it.
const revealedFooterPaths = new Set(['/', '/about'])

function measureRevealedFooter(container, footer) {
  const height = footer.offsetHeight
  container.style.setProperty('--revealed-footer-height', `${height}px`)
  // Larger screens fall back to normal flow when the footer cannot fit.
  // Mobile keeps the reveal and scrolls an unusually tall footer inside
  // its viewport-sized layer.
  const isMobile = window.matchMedia('(max-width: 620px)').matches
  container.classList.toggle('has-inline-footer', !isMobile && height > window.innerHeight)
}


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

function extractPage(documentHtml, pagePath, conversationArchiveEntry) {
  const styles = [...documentHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join('\n')
  const body = documentHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? documentHtml

  return {
    styles,
    body: wrapFooterReveal(
      addConversationArchiveEntry(
        addRouteBreadcrumbs(body.replace(/<script\b[\s\S]*?<\/script>/gi, ''), pagePath),
        conversationArchiveEntry,
      ),
    ),
  }
}

// The reveal frame the footer CSS clips into (see .footer-reveal in
// styles.css). Wrapped on every page; the frame is inert until the page is
// in revealedFooterPaths and the pinned treatment applies.
function wrapFooterReveal(body) {
  return body.replace(
    /(<footer\b[\s\S]*?<\/footer>)/i,
    '<div class="footer-reveal">$1</div>',
  )
}

export function StaticPage({ documentHtml, pagePath, title, conversationArchiveEntry = false }) {
  const containerRef = useRef(null)
  const navigate = useNavigate()
  const page = useMemo(
    () => extractPage(documentHtml, pagePath, conversationArchiveEntry),
    [conversationArchiveEntry, documentHtml, pagePath],
  )
  const shouldPlayHomeNavEntry = pagePath === '/' && !hasPlayedHomeNavEntry

  // The page reserves exactly the footer's height below it, so the pinned
  // footer is uncovered at the end of the scroll. The footer's height is
  // content- and viewport-dependent, so it is measured rather than assumed.
  //
  // This has to land before the first paint, and before the scroll
  // restoration below. The footer's pinned position and its inverted palette
  // both hang off .has-revealed-footer, so applying it after paint showed one
  // frame of a light, in-flow footer before it snapped dark and pinned. The
  // reserved margin is also part of the document height, so restoring scroll
  // without it clamps the position short on longer pages.
  useLayoutEffect(() => {
    const container = containerRef.current
    const footer = container?.querySelector('.site-footer')
    if (!footer || !revealedFooterPaths.has(pagePath)) return undefined

    container.classList.add('has-revealed-footer')
    measureRevealedFooter(container, footer)

    return () => {
      container.classList.remove('has-revealed-footer', 'has-inline-footer')
    }
  }, [documentHtml, pagePath])

  useLayoutEffect(() => {
    const savedPosition = savedScrollPositions.get(pagePath)
    savedScrollPositions.delete(pagePath)
    window.scrollTo(0, savedPosition ?? 0)
    if (shouldPlayHomeNavEntry) hasPlayedHomeNavEntry = true
  }, [pagePath, shouldPlayHomeNavEntry])


  useEffect(() => {
    document.title = title
  }, [title])

  // Keep the reserved height honest as the viewport or the footer's own
  // content changes after mount.
  useEffect(() => {
    const container = containerRef.current
    const footer = container?.querySelector('.site-footer')
    if (!footer || !revealedFooterPaths.has(pagePath)) return undefined

    const measure = () => measureRevealedFooter(container, footer)
    window.addEventListener('resize', measure)

    const observer = 'ResizeObserver' in window ? new ResizeObserver(measure) : null
    observer?.observe(footer)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [documentHtml, pagePath])

  // The footer's dot grid carries the same pointer searchlight as the chat
  // surface: two custom properties position the accent layer's mask, and the
  // is-lit class fades it in. Direct style and class writes — this fires per
  // pointer move, and the styling lives entirely in styles.css. Gated on the
  // event's own pointerType so a touch drag never lights it.
  useEffect(() => {
    const footer = containerRef.current?.querySelector('.site-footer')
    if (!footer || !revealedFooterPaths.has(pagePath)) return undefined

    const onMove = (event) => {
      if (event.pointerType !== 'mouse') return
      const bounds = footer.getBoundingClientRect()
      footer.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`)
      footer.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`)
      footer.classList.add('is-lit')
    }
    const onLeave = () => footer.classList.remove('is-lit')

    footer.addEventListener('pointermove', onMove)
    footer.addEventListener('pointerleave', onLeave)
    return () => {
      footer.removeEventListener('pointermove', onMove)
      footer.removeEventListener('pointerleave', onLeave)
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
  //
  // One thumb may point at a recording instead of a still (data-hero-video).
  // The player lives in the hero figure from the start and the figure's
  // .is-video class decides which medium shows, so selection stays a class
  // and attribute swap either way.
  useEffect(() => {
    const section = containerRef.current?.querySelector('.product-establishing')
    const hero = section?.querySelector('.establishing-shot')
    const heroCaption = hero?.querySelector('.establishing-caption')
    if (!section || !hero || !heroCaption) return undefined

    const heroNote = hero.querySelector('.establishing-note')
    const defaultNote = heroNote?.textContent
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    // The recording ships once per theme and CSS shows one of them, so the
    // player to drive is whichever is currently rendered.
    const videos = [...hero.querySelectorAll('.workspace-video')]
    const shownVideo = () => videos.find((candidate) => candidate.offsetParent !== null) ?? null
    const pauseVideos = () => videos.forEach((candidate) => candidate.pause())

    const select = (thumb) => {
      const isVideo = thumb.dataset.heroVideo === 'true'
      hero.classList.toggle('is-video', isVideo)

      if (isVideo) {
        if (!reducedMotion.matches) shownVideo()?.play().catch(() => {})
      } else {
        pauseVideos()
        const heroLight = hero.querySelector('.workspace-capture--light')
        const heroDark = hero.querySelector('.workspace-capture--dark')
        const thumbLight = thumb.querySelector('.workspace-capture--light')
        const thumbDark = thumb.querySelector('.workspace-capture--dark')

        heroLight.setAttribute('src', thumbLight.getAttribute('src'))
        heroDark.setAttribute('src', thumbDark.getAttribute('src'))
        heroLight.setAttribute('alt', thumb.dataset.heroAlt)
        heroDark.setAttribute('alt', thumb.dataset.heroAlt)
      }

      heroCaption.textContent = thumb.dataset.heroCaption
      // Pages where every still carries the same disclaimer leave the note
      // off the thumbs; those fall back to the one authored in the figure.
      if (heroNote) heroNote.textContent = thumb.dataset.heroNote ?? defaultNote

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

    // Autoplay is driven from here rather than the `autoplay` attribute:
    // the attribute overrides preload="none" on *both* players, so the theme
    // the reader cannot see would be downloaded alongside the one they can.
    // Starting the shown player by hand keeps it to one file, and gets the
    // rest for free — playback stops when the figure scrolls away and picks
    // up on the way back, and a reader who asked for less motion is simply
    // never started.
    //
    // Once the reader touches the player, the effect stops driving it: their
    // pause has to survive scrolling past and back.
    let observer = null
    let themeObserver = null
    let readerTookOver = false
    const onReaderInput = () => {
      readerTookOver = true
    }

    if (videos.length) {
      videos.forEach((candidate) => {
        candidate.addEventListener('pointerdown', onReaderInput)
        candidate.addEventListener('keydown', onReaderInput)
      })

      if (reducedMotion.matches) {
        videos.forEach((candidate) => candidate.removeAttribute('loop'))
      } else {
        if ('IntersectionObserver' in window) {
          observer = new IntersectionObserver(([entry]) => {
            if (readerTookOver || !hero.classList.contains('is-video')) return
            if (entry.isIntersecting) shownVideo()?.play().catch(() => {})
            else pauseVideos()
          }, { threshold: 0.2 })
          observer.observe(hero)
        } else if (hero.classList.contains('is-video')) {
          shownVideo()?.play().catch(() => {})
        }

        // Switching themes swaps in the other recording cold — it was never
        // fetched. Hand it the position the reader had reached so the switch
        // reads as a repaint of the same playback rather than a restart.
        themeObserver = new MutationObserver(() => {
          const next = shownVideo()
          if (!next) return
          const previous = videos.find((candidate) => candidate !== next && !candidate.paused)
          if (previous) {
            previous.pause()
            if (Number.isFinite(previous.currentTime)) next.currentTime = previous.currentTime
          }
          if (!readerTookOver && hero.classList.contains('is-video')) next.play().catch(() => {})
        })
        themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] })
      }
    }

    return () => {
      section.removeEventListener('click', onClick)
      observer?.disconnect()
      themeObserver?.disconnect()
      videos.forEach((candidate) => {
        candidate.removeEventListener('pointerdown', onReaderInput)
        candidate.removeEventListener('keydown', onReaderInput)
        candidate.pause()
      })
    }
  }, [documentHtml])

  // How near the pointer is to the operative node of a section, published as
  // --proximity-focus for the stylesheet to recede the rest against. Reaching
  // for something is a gradual thing, so the emphasis is gradual too: it
  // builds as the reader closes in and relaxes as they drift off, rather than
  // snapping on the moment the section is touched anywhere.
  //
  // Declared in the markup — a [data-proximity-scope] section naming the
  // [data-proximity-focus] node inside it — so any section can opt in without
  // the component knowing what it is. The homepage headline is the first.
  useEffect(() => bindProximityScopes(containerRef.current), [documentHtml])

  // The introduction inks itself in as the reader scrolls into it. The words
  // rest at a low ink level and come up to full strength in reading order,
  // tied to scroll position rather than to a clock — the reader sets the
  // pace. Nothing is ever hidden, only quieter: a sentence with a hole in it
  // reads as broken rather than as arriving, which is the lesson the hero
  // headline's entrance already learned.
  //
  // Each block fills over its own approach, since the two are separate
  // thoughts sitting most of a screen apart. A filled block stays filled —
  // re-dimming an introduction on the way back up would turn it into
  // furniture — so a block retires its own scroll machinery once it lands.
  useLayoutEffect(() => {
    const container = containerRef.current

    // Sections that answer the pointer only once they have finished arriving.
    // Reaching for a phrase that is still inking in would have the page
    // pulling in two directions at once, so the proximity effect waits its
    // turn — and waits for the whole introduction, because the scope spans
    // both blocks: reaching for the greeting recedes the Athena line too, and
    // a line cannot recede while it is still arriving.
    const deferred = [...(container?.querySelectorAll('[data-proximity-when="revealed"]') ?? [])]
    const bound = []
    const settle = (within) => {
      deferred
        .filter((scope) => scope === within || within.contains(scope))
        .forEach((scope) => bound.push(bindProximityScope(scope)))
    }
    const unbind = () => bound.forEach((teardown) => teardown())

    // Every way the reveal declines to run leaves the words at full ink
    // already, so there is nothing to wait for and the effect binds at once.
    const copy = container?.querySelector('.bridge-copy')
    const blocks = [...(copy?.querySelectorAll('.bridge-block') ?? [])]
    const skipsReveal = !copy
      || hasRevealedIntro
      || !blocks.length
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (skipsReveal) {
      deferred.forEach((scope) => bound.push(bindProximityScope(scope)))
      return unbind
    }

    // The lines already sit at 65% ink from the stylesheet, so this
    // multiplies down against that rather than against full black: the
    // resting state lands near 5% effective alpha — present as a shape on
    // the page, not yet readable as a sentence.
    const RESTING_INK = 0.08

    const teardowns = []
    let landed = 0

    blocks.forEach((block) => {
      // The splitter wraps words while leaving the inline markup — the
      // emphasis spans and the Athena link — intact, and keeps the original
      // wording exposed to assistive tech rather than a bag of spans.
      //
      // One splitter per line, not one per block: TextSplitter takes a single
      // element and silently keeps only the first of a list, which left every
      // line after the opening greeting undimmed and out of the cascade.
      const splitters = [...block.querySelectorAll('.bridge-line')].map((line) => (
        split(line, { words: true, chars: false, accessible: true })
      ))
      const words = splitters.flatMap((splitter) => splitter.words)

      // The splitter only wraps text, so an inline icon would sit at full ink
      // while the words around it are still faint. The Athena arrow joins the
      // cascade in its reading position instead.
      //
      // Accessible mode leaves a clipped clone of the whole line — markup and
      // icon included — ahead of the visible words, so an icon only counts as
      // visible if it follows the first word span in document order.
      const isVisible = (node) => words.length > 0 && Boolean(
        words[0].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
      )
      const icons = [...block.querySelectorAll('.inline-link-icon')].filter(isVisible)

      const tokens = [...words, ...icons].sort((a, b) => (
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      ))
      set(tokens, { opacity: RESTING_INK })

      // The completion callback can fire while onScroll() is still
      // constructing — a reader restored partway down the page lands with
      // this block already past its fill range — so the callback is routed
      // through a slot that is only armed once both handles exist.
      let onLanded = () => {}

      const observer = onScroll({
        target: block,
        // Starts as the block's first line clears the fold and finishes
        // while the block is still short of centre, so a reader finishes
        // reading it before it settles rather than after it has gone by.
        enter: 'bottom top',
        leave: 'center center',
        // Under 1 follows the scroll with a little lag, which keeps the
        // ramp from stepping on a trackpad's coarser scroll deltas. Held
        // high: at 0.6 the ink trailed far enough behind a brisk scroll
        // that the section arrived unpainted and then rushed to catch up.
        sync: 0.85,
        onSyncComplete: () => onLanded(),
        // Crossing the leave line forward means the block has been read;
        // retire it on that raw crossing rather than waiting for the
        // smoothed fill to land. Completion is the only thing keeping a
        // filled block filled, and a quick reversal used to outrun it —
        // leaving the animation live to run the introduction backwards.
        onLeaveForward: () => onLanded(),
      })

      animate(tokens, {
        opacity: 1,
        // Held linear: this is ink arriving, not an object travelling, and
        // the scroll position — not an easing curve — is the storyteller.
        ease: 'linear',
        duration: 420,
        delay: stagger(60),
        autoplay: observer,
      })

      let retired = false
      // `didFill` separates the two ways a block stops being animated. Only
      // a block the reader actually filled counts towards retiring the whole
      // section; leaving the homepage before ever reaching the introduction
      // must not spend its one reveal.
      const retire = (didFill) => {
        if (retired) return
        retired = true
        observer.revert()
        // Hand the words back to the stylesheet at full strength, then put
        // the original markup back now that nothing is animating it.
        remove(tokens)
        splitters.forEach((splitter) => splitter.revert())
        if (!didFill) return
        landed += 1
        if (landed < blocks.length) return
        hasRevealedIntro = true
        // After the last revert, so the introduction's own markup — and the
        // focus nodes inside it — is back in place to be measured.
        settle(copy)
      }

      onLanded = () => retire(true)
      teardowns.push(() => retire(false))

      // Covers the same already-past-the-range case: the callback fired into
      // the empty slot above, so the block has to be retired here instead.
      if (observer.completed) retire(true)
    })

    return () => {
      teardowns.forEach((retire) => retire())
      unbind()
    }
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
      const isConversationArchivePath = conversationArchiveEntry
        && path === PRIVATE_ROUTE_PATHS.conversations
      if (target.origin !== window.location.origin
        || (!NAVIGABLE_PATHS.has(path) && !isConversationArchivePath)) return

      const destinationHash = target.hash

      event.preventDefault()
      recordNavigation(returnStack, {
        from: normalisePath(pagePath),
        to: path,
        viaReturnLink: link.classList.contains('hero-return'),
      })
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
  }, [conversationArchiveEntry, navigate, pagePath])

  useEffect(() => {
    const nav = containerRef.current?.querySelector('.rail-nav[aria-label="On this page"]')
    if (!nav) return undefined

    const links = [...nav.querySelectorAll('a[href^="#"]')]
    const indicator = nav.querySelector('.rail-indicator')
    const sections = links.map((link) => document.getElementById(link.hash.slice(1))).filter(Boolean)
    let frame
    // The scroll handler re-derives the active link every frame, but writing
    // aria-current and the indicator transform on frames where nothing changed
    // invalidates style and paint for no visual difference — the same
    // per-frame-write pattern that made the progress ring repaint the page.
    let currentLink = null

    const setActiveLink = (activeLink) => {
      if (activeLink === currentLink) return
      currentLink = activeLink
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
      // Shared with the mobile reading-position control, which reports the
      // same fact from the corner: two thresholds would let the rail and the
      // control disagree about which section the reader is in.
      const readingLine = readingLineFor(window.innerHeight)
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
