import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react'

const STARTERS = [
  'What is Athena?',
  "What's Kwamina's background?",
  'How does he work with AI agents?',
]

function messageText(message) {
  return (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
    .join('')
}

const GENERIC_ERROR = 'Something went wrong. Try asking again.'

// The Worker explains its own refusals — "that was a little fast", "questions
// are limited to 2000 characters" — but none of that wording can reach the
// reader through the error the hook exposes: the connection adapter replaces a
// non-OK response with "HTTP error! status: 429" and discards the body, and
// what surfaces from `useChat` is a flattened plain Error with no `cause`. So
// the message is read here, where the response still exists, and left in a ref
// for the render that the failure is about to trigger.
async function chatFetch(input, init, messageRef) {
  messageRef.current = null

  let response
  try {
    response = await fetch(input, init)
  } catch {
    messageRef.current = 'Could not reach the assistant. Check your connection and try again.'
    throw new Error(messageRef.current)
  }

  if (response.ok) return response

  const message = await response
    .json()
    .then((body) => body?.error)
    .catch(() => null)

  messageRef.current = message || GENERIC_ERROR
  throw new Error(messageRef.current)
}

// Default-exported so the launcher can reach it through React.lazy. The
// TanStack AI client is ~150kB of the bundle; a reader who never opens the
// chat should never download it.
export default function ChatPanel({ thread, onClose }) {
  const [input, setInput] = useState('')
  const [isRehydrating, setIsRehydrating] = useState(thread.isReturning)
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const logRef = useRef(null)

  // Written by chatFetch on the failing request, read on the render that
  // failure causes. Built once so the hook keeps one connection identity.
  const serverMessageRef = useRef(null)
  const connection = useMemo(
    () => fetchServerSentEvents('/api/chat', {
      fetchClient: (input, init) => chatFetch(input, init, serverMessageRef),
    }),
    [],
  )

  const { messages, sendMessage, setMessages, isLoading, error } = useChat({
    connection,
    threadId: thread.id,
  })

  // A returning reader's transcript lives only on the server, so the panel
  // replays it before accepting a new question. Failing quietly is right here:
  // an unreachable transcript should cost them their scrollback, not their
  // ability to ask something.
  useEffect(() => {
    if (!thread.isReturning) return undefined

    const abort = new AbortController()

    fetch(`/api/chat/${thread.id}`, { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : { messages: [] }))
      .then((data) => {
        const stored = (data.messages ?? []).map((message, index) => ({
          id: `stored-${index}`,
          role: message.role,
          parts: [{ type: 'text', content: message.content }],
        }))
        if (stored.length) setMessages(stored)
      })
      .catch(() => {})
      .finally(() => {
        if (!abort.signal.aborted) setIsRehydrating(false)
      })

    return () => abort.abort()
  }, [thread.id, thread.isReturning, setMessages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Follow the answer as it streams, but never yank the view away from someone
  // who has scrolled up to reread something.
  useEffect(() => {
    const log = logRef.current
    if (!log) return
    const isNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120
    if (isNearBottom) log.scrollTop = log.scrollHeight
  }, [messages])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      // Focus stays inside the panel while it is open.
      const focusable = panelRef.current?.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled]), a[href]',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const submit = useCallback(
    (text) => {
      const question = text.trim()
      if (!question || isLoading) return
      sendMessage(question)
      setInput('')
    },
    [isLoading, sendMessage],
  )

  const isEmpty = messages.length === 0

  return (
    <div
      className="site-chat-panel"
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Ask about Kwamina"
    >
      <header className="site-chat-header">
        <p className="site-chat-title">Ask about Kwamina</p>
        <button type="button" className="site-chat-close" onClick={onClose} aria-label="Close chat">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className="site-chat-log" ref={logRef} role="log" aria-live="polite" aria-busy={isLoading}>
        {isRehydrating && <p className="site-chat-note">Picking up where you left off&hellip;</p>}

        {isEmpty && !isRehydrating && (
          <div className="site-chat-intro">
            <p>
              Answers come from this site&rsquo;s own pages, so anything here is something you could
              read for yourself.
            </p>
            <ul className="site-chat-starters">
              {STARTERS.map((starter) => (
                <li key={starter}>
                  <button type="button" onClick={() => submit(starter)}>
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* A run that fails before its first token leaves an assistant message
            with no text behind it; rendering that is an empty bubble sitting
            above the error. */}
        {messages
          .map((message) => ({ message, text: messageText(message) }))
          .filter(({ text }) => text.trim())
          .map(({ message, text }) => (
            <p key={message.id} className={`site-chat-message is-${message.role}`}>
              {text}
            </p>
          ))}

        {isLoading && (
          <p className="site-chat-typing" aria-hidden="true">
            <span />
            <span />
            <span />
          </p>
        )}

        {error && (
          <p className="site-chat-error" role="alert">
            {serverMessageRef.current || GENERIC_ERROR}
          </p>
        )}
      </div>

      <form
        className="site-chat-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit(input)
        }}
      >
        <textarea
          ref={inputRef}
          className="site-chat-input"
          value={input}
          rows={1}
          placeholder="Ask a question&hellip;"
          maxLength={2000}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline, as in every chat the
            // reader already uses.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit(input)
            }
          }}
        />
        <button type="submit" className="site-chat-send" disabled={!input.trim() || isLoading} aria-label="Send">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h13M12 5l7 7-7 7" />
          </svg>
        </button>
      </form>
    </div>
  )
}
