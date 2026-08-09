import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { SCROLL_TO_TOP_REVEAL_PX } from '../scroll-progress.js'
import { useFooterOverlap } from '../use-footer-overlap.js'
import { animateSplit } from './launcher-split.js'

// The panel pulls in the TanStack AI client, which is the single largest
// dependency on the site. Loading it on first open keeps it off the critical
// path for every reader who never asks a question.
const ChatPanel = lazy(() => import('./chat-panel.jsx'))
export const CHAT_LAUNCHER_LABEL = 'Chat'
export const CHAT_LAUNCHER_ARIA_LABEL = 'Chat with Kwamina'

const threadStorageKey = 'kwamina-fyi-chat-thread'
const MOBILE_TAKEOVER_QUERY = '(max-width: 620px)'
const restoredViewportTolerance = 1
const layoutRecoveryDelays = [250, 500, 1000, 1500]

export function ChatPanelFallback({ onClose }) {
  return (
    <section
      className="site-chat-panel"
      role="dialog"
      aria-label="Ask about Kwamina"
      aria-busy="true"
    >
      <header className="site-chat-header">
        <p className="site-chat-title">Ask about Kwamina</p>
        <button
          type="button"
          className="site-chat-close"
          onClick={onClose}
          aria-label="Close chat"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className="site-chat-surface">
        <div className="site-chat-log">
          <p className="site-chat-note" role="status">Opening chat…</p>
        </div>
      </div>
    </section>
  )
}

export function createThread({
  randomUUID = () => window.crypto.randomUUID(),
  persist = (key, value) => window.localStorage.setItem(key, value),
} = {}) {
  const thread = { id: randomUUID(), isReturning: false }
  try {
    persist(threadStorageKey, thread.id)
  } catch {
    // Storage can be denied in private browsing. The in-memory thread still
    // works for this page view.
  }
  return thread
}

// The thread id is the conversation's whole identity — the server keys the
// stored transcript on it and trusts its own copy of the history over anything
// the client sends. Minted once and kept, so a return visit picks the
// conversation back up.
function readThreadId() {
  try {
    const existing = window.localStorage.getItem(threadStorageKey)
    if (existing) return { id: existing, isReturning: true }
  } catch {
    // Fall through to an in-memory conversation when storage is unavailable.
  }
  return createThread()
}

// Closing the panel discards useChat's component-local message state. The id
// still names the same server-side conversation, so every later mount must
// replay that transcript just like a page reload does.
export function returningThread(thread) {
  return { ...thread, isReturning: true }
}

export function collapseMobileChatOnSiteNavigation({
  isMobile = window.matchMedia(MOBILE_TAKEOVER_QUERY).matches,
  event,
  collapse,
} = {}) {
  if (
    !isMobile
    || event?.defaultPrevented
    || event?.button > 0
    || event?.metaKey
    || event?.ctrlKey
    || event?.shiftKey
    || event?.altKey
  ) return false
  collapse()
  return true
}

export function shouldRestoreLauncherFocus({ isMobile, event } = {}) {
  // Escape and keyboard-activated buttons have no pointer click detail. A
  // touch close should reveal the page without leaving focus painted around
  // the launcher, while keyboard users keep the return-focus affordance.
  return !isMobile || !event || event.detail === 0
}

export function subscribeToMobileTakeover(
  onChange,
  media = window.matchMedia(MOBILE_TAKEOVER_QUERY),
) {
  const update = () => onChange(media.matches)
  update()
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}

export function lockMobilePageScroll({
  body = document.body,
  root = document.documentElement,
  isMobile = window.matchMedia(MOBILE_TAKEOVER_QUERY).matches,
  scrollY,
  scrollTo,
} = {}) {
  if (!isMobile) return () => {}

  const lockedScrollY = scrollY ?? window.scrollY
  const restoreScroll = scrollTo ?? ((...args) => window.scrollTo(...args))
  const previousBodyOverflow = body.style.overflow
  const previousRootOverflow = root.style.overflow

  body.classList.add('site-chat-open')
  body.style.overflow = 'hidden'
  root.style.overflow = 'hidden'

  let isUnlocked = false
  return () => {
    if (isUnlocked) return
    isUnlocked = true

    body.classList.remove('site-chat-open')
    body.style.overflow = previousBodyOverflow
    root.style.overflow = previousRootOverflow
    restoreScroll(0, lockedScrollY)
  }
}

export function watchMobileViewportRestoration({
  body = document.body,
  root = document.documentElement,
  isMobile = window.matchMedia(MOBILE_TAKEOVER_QUERY).matches,
  viewport = window.visualViewport,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frame) => window.cancelAnimationFrame(frame),
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
} = {}) {
  if (!isMobile || !viewport) return () => {}

  let frame = null
  const timers = []
  const resetScrollOffset = () => {
    root.scrollTop = 0
    body.scrollTop = 0
  }
  const restoreFromViewport = () => {
    frame = null
    if (Math.abs(viewport.height - root.clientHeight) > restoredViewportTolerance) return
    resetScrollOffset()
  }
  const scheduleRestore = () => {
    if (frame !== null) return
    frame = requestFrame(restoreFromViewport)
  }
  const restoreFromLayout = () => {
    if (documentObject?.activeElement?.tagName === 'TEXTAREA') return
    if (Math.abs(windowObject.innerHeight - root.clientHeight) > restoredViewportTolerance) return
    resetScrollOffset()
  }
  const onFocusOut = (event) => {
    if (event.target?.tagName !== 'TEXTAREA') return
    for (const delay of layoutRecoveryDelays) {
      timers.push(setTimer(restoreFromLayout, delay))
    }
  }

  viewport.addEventListener('resize', scheduleRestore)
  documentObject?.addEventListener('focusout', onFocusOut)
  return () => {
    viewport.removeEventListener('resize', scheduleRestore)
    documentObject?.removeEventListener('focusout', onFocusOut)
    if (frame !== null) cancelFrame(frame)
    for (const timer of timers) clearTimer(timer)
  }
}

// The launcher shares its corner with the scroll-to-top control, which appears
// at the same threshold. Rather than stack them, the pill sheds its label and
// contracts to a disc as that control separates out from underneath it — one
// shape dividing into two, which only reads as a division if both halves end up
// the same shape. The travel itself is in styles.css; this only decides when.
//
// Reading the same constant the other control reads is the point: a threshold
// duplicated as a literal here would drift the two motions apart the moment
// either side was retuned.
function useIsCollapsed() {
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    let frame = 0
    let current = false

    const read = () => {
      frame = 0
      const next = window.scrollY > SCROLL_TO_TOP_REVEAL_PX
      if (next === current) return
      current = next
      setIsCollapsed(next)
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read)
    }

    read()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })

    // A route swap changes the scrollable distance without a scroll event.
    const observer = 'ResizeObserver' in window ? new ResizeObserver(schedule) : null
    observer?.observe(document.body)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [])

  return isCollapsed
}

function useMobileTakeover() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_TAKEOVER_QUERY).matches,
  )

  useEffect(() => subscribeToMobileTakeover(setIsMobile), [])
  return isMobile
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [thread, setThread] = useState(null)
  const launcherRef = useRef(null)
  const labelRef = useRef(null)
  const timelineRef = useRef(null)
  const teardownMobilePageRef = useRef(null)
  const hasAnimatedRef = useRef(false)
  const isCollapsed = useIsCollapsed()
  const isMobileTakeover = useMobileTakeover()
  const isOnFooter = useFooterOverlap(launcherRef)

  // An open panel holds the launcher at its collapsed disc: a pill expanding
  // underneath an open panel is motion with nothing to say.
  const shouldCollapse = isCollapsed || isOpen

  useLayoutEffect(() => {
    if (!isOpen) return undefined
    const unlock = lockMobilePageScroll({ isMobile: isMobileTakeover })
    const stopViewportRestoration = watchMobileViewportRestoration({
      isMobile: isMobileTakeover,
    })
    const teardown = () => {
      stopViewportRestoration()
      unlock()
    }
    teardownMobilePageRef.current = teardown
    return () => {
      if (teardownMobilePageRef.current === teardown) teardownMobilePageRef.current = null
      teardown()
    }
  }, [isMobileTakeover, isOpen])

  // Layout effect, not a passive one: React has already committed the split
  // geometry by the time this runs, and the timeline's opening move is to put
  // the icon back where the reader last saw it. A frame painted in between
  // would show it in its new place and then jump back.
  useLayoutEffect(() => {
    const launcher = launcherRef.current
    if (!launcher) return undefined

    const play = (immediate) => {
      timelineRef.current?.pause()
      timelineRef.current = animateSplit({
        launcher,
        label: labelRef.current,
        isCollapsed: shouldCollapse,
        immediate,
      })
    }

    // First paint lands on the end state with no travel; a threshold crossing
    // animates.
    play(!hasAnimatedRef.current)
    hasAnimatedRef.current = true

    // Crossing the breakpoint changes both the pill's widths and the distance
    // the ring travels. Re-apply without animating: the reader resized the
    // window, they did not cross the scroll threshold.
    const breakpoint = window.matchMedia(MOBILE_TAKEOVER_QUERY)
    const onBreakpointChange = () => play(true)
    breakpoint.addEventListener('change', onBreakpointChange)

    return () => {
      breakpoint.removeEventListener('change', onBreakpointChange)
      timelineRef.current?.pause()
    }
  }, [shouldCollapse])

  const open = () => {
    // Deferred to the first open so a reader who never uses the chat is never
    // assigned an id at all.
    setThread(thread ? returningThread(thread) : readThreadId())
    setIsOpen(true)
  }

  const collapse = useCallback(({ restoreFocus = false } = {}) => {
    // Internal navigation can swap the page before React unmounts the panel.
    // Release the mobile page lock synchronously so its old scroll position
    // cannot be restored onto the destination page.
    teardownMobilePageRef.current?.()
    teardownMobilePageRef.current = null
    setIsOpen(false)
    if (restoreFocus) launcherRef.current?.focus()
  }, [])

  const close = useCallback((event) => collapse({
    restoreFocus: shouldRestoreLauncherFocus({ isMobile: isMobileTakeover, event }),
  }), [collapse, isMobileTakeover])

  const onSiteNavigate = useCallback((event) => {
    collapseMobileChatOnSiteNavigation({
      isMobile: isMobileTakeover,
      event,
      collapse,
    })
  }, [collapse, isMobileTakeover])

  const startNewChat = useCallback(() => {
    setThread(createThread())
  }, [])

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={[
          'site-chat-launcher',
          shouldCollapse && 'is-collapsed',
          // The collapsed geometry rides with React rather than being toggled
          // from the timeline: any re-render — the footer palette swap fires
          // one mid-scroll — rewrites className and would drop a class the
          // animation had set behind React's back.
          shouldCollapse && 'is-split',
          isOpen && 'is-open',
          isOnFooter && 'is-on-footer',
        ].filter(Boolean).join(' ')}
        onClick={(event) => (isOpen ? close(event) : open())}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close chat' : CHAT_LAUNCHER_ARIA_LABEL}
      >
        {/* The pill itself. A separate element because collapsing it to a disc
            is done with transforms on overlapping opaque pieces, which have to
            be faded as one group — see styles.css. Two of the three pieces are
            pseudo-elements; the travelling left cap needs a real one. */}
        <span className="site-chat-launcher-shadow" aria-hidden="true" />
        <span className="site-chat-launcher-surface" aria-hidden="true">
          <span className="site-chat-launcher-cap" />
        </span>
        <svg className="site-chat-launcher-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />
        </svg>
        {/* aria-hidden rather than removed: the button's own label already
            names it, so the shrinking text should not be read twice. */}
        <span ref={labelRef} className="site-chat-launcher-label" aria-hidden="true">{CHAT_LAUNCHER_LABEL}</span>
      </button>

      {isOpen && thread && (
        <Suspense fallback={<ChatPanelFallback onClose={close} />}>
          <ChatPanel
            key={thread.id}
            thread={thread}
            onClose={close}
            onNewChat={startNewChat}
            onSiteNavigate={onSiteNavigate}
          />
        </Suspense>
      )}
    </>
  )
}
