import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { SCROLL_TO_TOP_REVEAL_PX } from '../scroll-progress.js'
import { useFooterOverlap } from '../use-footer-overlap.js'
import { animateSplit } from './launcher-split.js'

// The panel pulls in the TanStack AI client, which is the single largest
// dependency on the site. Loading it on first open keeps it off the critical
// path for every reader who never asks a question.
const ChatPanel = lazy(() => import('./chat-panel.jsx'))

const threadStorageKey = 'kwamina-fyi-chat-thread'

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

export function syncChatPageOpen(classList, isOpen) {
  classList.toggle('site-chat-open', isOpen)
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

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [thread, setThread] = useState(null)
  const launcherRef = useRef(null)
  const labelRef = useRef(null)
  const timelineRef = useRef(null)
  const hasAnimatedRef = useRef(false)
  const isCollapsed = useIsCollapsed()
  const isOnFooter = useFooterOverlap(launcherRef)

  // An open panel holds the launcher at its collapsed disc: a pill expanding
  // underneath an open panel is motion with nothing to say.
  const shouldCollapse = isCollapsed || isOpen

  useEffect(() => {
    syncChatPageOpen(document.body.classList, isOpen)
    return () => syncChatPageOpen(document.body.classList, false)
  }, [isOpen])

  useEffect(() => {
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
    const breakpoint = window.matchMedia('(max-width: 620px)')
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

  const close = useCallback(() => {
    setIsOpen(false)
    launcherRef.current?.focus()
  }, [])

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
          isOpen && 'is-open',
          isOnFooter && 'is-on-footer',
        ].filter(Boolean).join(' ')}
        onClick={() => (isOpen ? close() : open())}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close chat' : 'Ask about Kwamina'}
      >
        <svg className="site-chat-launcher-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />
        </svg>
        {/* aria-hidden rather than removed: the button's own label already
            names it, so the shrinking text should not be read twice. */}
        <span ref={labelRef} className="site-chat-launcher-label" aria-hidden="true">Ask</span>
      </button>

      {isOpen && thread && (
        <Suspense fallback={null}>
          <ChatPanel key={thread.id} thread={thread} onClose={close} onNewChat={startNewChat} />
        </Suspense>
      )}
    </>
  )
}
