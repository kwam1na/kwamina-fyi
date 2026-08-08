import { lazy, Suspense, useCallback, useRef, useState } from 'react'

// The panel pulls in the TanStack AI client, which is the single largest
// dependency on the site. Loading it on first open keeps it off the critical
// path for every reader who never asks a question.
const ChatPanel = lazy(() => import('./chat-panel.jsx'))

const threadStorageKey = 'kwamina-fyi-chat-thread'

// The thread id is the conversation's whole identity — the server keys the
// stored transcript on it and trusts its own copy of the history over anything
// the client sends. Minted once and kept, so a return visit picks the
// conversation back up.
function readThreadId() {
  try {
    const existing = window.localStorage.getItem(threadStorageKey)
    if (existing) return { id: existing, isReturning: true }
    const id = window.crypto.randomUUID()
    window.localStorage.setItem(threadStorageKey, id)
    return { id, isReturning: false }
  } catch {
    // Private browsing with storage denied: the chat still works, it just
    // starts fresh every time.
    return { id: window.crypto.randomUUID(), isReturning: false }
  }
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [thread, setThread] = useState(null)
  const launcherRef = useRef(null)

  const open = () => {
    // Deferred to the first open so a reader who never uses the chat is never
    // assigned an id at all.
    if (!thread) setThread(readThreadId())
    setIsOpen(true)
  }

  const close = useCallback(() => {
    setIsOpen(false)
    launcherRef.current?.focus()
  }, [])

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={`site-chat-launcher${isOpen ? ' is-open' : ''}`}
        onClick={() => (isOpen ? close() : open())}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close chat' : 'Ask about Kwamina'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />
        </svg>
        <span>Ask</span>
      </button>

      {isOpen && thread && (
        <Suspense fallback={null}>
          <ChatPanel thread={thread} onClose={close} />
        </Suspense>
      )}
    </>
  )
}
