import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react'
import { Link, useRouterState } from '@tanstack/react-router'
import { animate } from 'animejs'
import { NoticeArrow } from '../notice-page.jsx'
import { chatTextParts } from './chat-links.js'
import { fetchStoredMessages } from './chat-transcript.js'
import { chatPageLabelForPath, chatTitleForPath } from './chat-title.js'
import { FlipText } from './flip-text.jsx'
import { watchMobileChatViewport } from './mobile-viewport.js'
import { revealDuration, revealedPrefix } from './stream-reveal.js'

const STARTERS = [
  "What's Kwamina's background?",
  'What is Athena?',
  'How does he work with AI agents?',
]

function messageText(message) {
  return (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
    .join('')
}

const GENERIC_ERROR = 'Something went wrong. Try asking again.'
const TRANSCRIPT_TIMEOUT_MS = 8_000

function ChatLink({ part, onSiteNavigate }) {
  if (part.type === 'link') return <Link to={part.to} onClick={onSiteNavigate}>{part.text}</Link>
  if (part.type !== 'external-link') return part.text

  const opensNewTab = part.href.startsWith('http') || part.href.endsWith('.pdf')
  return (
    <a
      href={part.href}
      target={opensNewTab ? '_blank' : undefined}
      rel={opensNewTab ? 'noreferrer' : undefined}
    >
      {part.text}
      <NoticeArrow className="inline-link-icon" />
    </a>
  )
}

function ChatText({ text, hideIncompleteSiteLink = false, onSiteNavigate }) {
  return chatTextParts(text, { hideIncompleteSiteLink }).map((part, index) => {
    if (part.bold) {
      return <strong key={`strong-${index}`}><ChatLink part={part} onSiteNavigate={onSiteNavigate} /></strong>
    }

    return part.type === 'link' || part.type === 'external-link'
      ? <ChatLink key={`${part.to ?? part.href}-${index}`} part={part} onSiteNavigate={onSiteNavigate} />
      : part.text
  })
}

function StreamingText({ text, isStreaming, onReveal, onSiteNavigate }) {
  const [visibleText, setVisibleText] = useState(() => (isStreaming ? '' : text))
  const visibleRef = useRef(visibleText)
  const animationRef = useRef(null)

  useEffect(() => {
    const revealImmediately = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || !text.startsWith(visibleRef.current)

    animationRef.current?.cancel()
    animationRef.current = null

    if (revealImmediately) {
      visibleRef.current = text
      setVisibleText(text)
      onReveal()
      return undefined
    }

    const visibleLength = Array.from(visibleRef.current).length
    const targetLength = Array.from(text).length
    const pendingCharacters = targetLength - visibleLength
    if (pendingCharacters <= 0) return undefined

    const progress = { characters: visibleLength }
    animationRef.current = animate(progress, {
      characters: targetLength,
      duration: revealDuration(pendingCharacters, isStreaming),
      ease: 'linear',
      onUpdate: () => {
        const nextText = revealedPrefix(text, progress.characters)
        if (nextText === visibleRef.current) return
        visibleRef.current = nextText
        setVisibleText(nextText)
        onReveal()
      },
      onComplete: () => {
        visibleRef.current = text
        setVisibleText(text)
        animationRef.current = null
        onReveal()
      },
    })

    return () => {
      animationRef.current?.cancel()
      animationRef.current = null
    }
  }, [isStreaming, onReveal, text])

  return (
    <ChatText
      text={visibleText}
      hideIncompleteSiteLink={isStreaming || visibleText !== text}
      onSiteNavigate={onSiteNavigate}
    />
  )
}

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
export default function ChatPanel({
  thread,
  isMobileTakeover,
  onClose,
  onNewChat,
  onSiteNavigate,
}) {
  const [input, setInput] = useState('')
  const [replayStatus, setReplayStatus] = useState(thread.isReturning ? 'loading' : 'idle')
  const isRehydrating = replayStatus === 'loading'
  const replayError = replayStatus === 'failed'
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const logRef = useRef(null)
  const isSubmittingRef = useRef(false)

  // Written by chatFetch on the failing request, read on the render that
  // failure causes. Built once so the hook keeps one connection identity.
  const serverMessageRef = useRef(null)
  const connection = useMemo(
    () => fetchServerSentEvents('/api/chat', {
      fetchClient: (input, init) => chatFetch(input, init, serverMessageRef),
    }),
    [],
  )

  // The panel floats over the page and the reader can keep navigating with it
  // open, so this has to track the route rather than be captured once. useChat
  // pushes a changed value down to the client, which reads it when the next
  // message is sent — so "tell me about this page" means whichever page they
  // are on at the moment they ask, not the one they opened the chat from.
  const pagePath = useRouterState({ select: (state) => state.location.pathname })
  const forwardedProps = useMemo(() => ({ pagePath }), [pagePath])
  const chatTitle = chatTitleForPath(pagePath)
  const chatPageLabel = chatPageLabelForPath(pagePath)

  const { messages, sendMessage, setMessages, isLoading, error } = useChat({
    connection,
    threadId: thread.id,
    forwardedProps,
  })

  // A returning reader's transcript lives only on the server, so the panel
  // replays it before accepting a new question. A failed replay stays visible
  // and retryable; the composer remains available so a network blip never
  // traps the reader in a dead-end state.
  useEffect(() => {
    if (replayStatus !== 'loading') return undefined

    const abort = new AbortController()
    let disposed = false
    const timeout = window.setTimeout(() => abort.abort(), TRANSCRIPT_TIMEOUT_MS)

    fetchStoredMessages(thread.id, { signal: abort.signal })
      .then((stored) => {
        if (disposed) return
        setMessages(stored)
        setReplayStatus('loaded')
      })
      .catch(() => {
        if (!disposed) setReplayStatus('failed')
      })
      .finally(() => {
        window.clearTimeout(timeout)
      })

    return () => {
      disposed = true
      window.clearTimeout(timeout)
      abort.abort()
    }
  }, [replayStatus, thread.id, setMessages])

  // Install this before the passive autofocus effect. On iOS the keyboard
  // shrinks window.visualViewport after focus without changing the layout
  // viewport that 100dvh measures, so the takeover must follow that resize to
  // keep its bottom-anchored composer visible on the very first interaction.
  useLayoutEffect(
    () => watchMobileChatViewport(panelRef.current, { isMobile: isMobileTakeover }),
    [isMobileTakeover],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Follow the answer as it streams, but never yank the view away from someone
  // who has scrolled up to reread something.
  const followLatest = useCallback(() => {
    const log = logRef.current
    if (!log) return
    const isNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120
    if (isNearBottom) log.scrollTop = log.scrollHeight
  }, [])

  useEffect(() => {
    followLatest()
  }, [followLatest, messages])

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
      if (!question || isLoading || isRehydrating || isSubmittingRef.current) return
      isSubmittingRef.current = true
      if (replayStatus === 'failed') setReplayStatus('continued')
      void sendMessage(question, { whenBusy: 'drop' }).finally(() => {
        isSubmittingRef.current = false
      })
      setInput('')
    },
    [isLoading, isRehydrating, replayStatus, sendMessage],
  )

  const retryTranscript = useCallback(() => {
    inputRef.current?.focus()
    setReplayStatus('loading')
  }, [])

  const isEmpty = messages.length === 0

  const surfaceRef = useRef(null)

  // The searchlight follows the pointer by writing two custom properties the
  // grid's mask reads. Direct style and class writes, not state: this fires on
  // every pointer move, and a re-render per move would repaint the whole
  // transcript to reposition a gradient.
  //
  // Lighting is gated on the event's own pointerType rather than a hover media
  // query: a touch drag fires these events too, but there is no cursor to
  // search with, so a finger keeps the quiet base grid.
  const onSurfaceMove = useCallback((event) => {
    const surface = surfaceRef.current
    if (!surface || event.pointerType !== 'mouse') return
    const bounds = surface.getBoundingClientRect()
    surface.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`)
    surface.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`)
    surface.classList.add('is-lit')
  }, [])

  const onSurfaceLeave = useCallback(() => {
    surfaceRef.current?.classList.remove('is-lit')
  }, [])

  return (
    <div
      className="site-chat-panel"
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={chatTitle}
    >
      <header className="site-chat-header">
        <p className="site-chat-title">Ask about <FlipText value={chatPageLabel} /></p>
        <div className="site-chat-header-actions">
          {!isEmpty && (
            <button type="button" className="site-chat-new" onClick={onNewChat}>New chat</button>
          )}
          <button type="button" className="site-chat-close" onClick={onClose} aria-label="Close chat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Everything below the header shares one textured surface: the dot
          grid sits on this wrapper, behind the transcript and the composer
          alike, so the searchlight sweeps one continuous field rather than
          restarting at the composer's edge. The header stays outside it. */}
      <div
        className="site-chat-surface"
        ref={surfaceRef}
        onPointerMove={onSurfaceMove}
        onPointerLeave={onSurfaceLeave}
      >
      <div
        className="site-chat-log"
        ref={logRef}
        role="log"
        aria-live={isLoading ? 'off' : 'polite'}
        aria-busy={isLoading}
      >
        {isRehydrating && <p className="site-chat-note">Picking up where you left off&hellip;</p>}

        {replayError && (
          <div className="site-chat-replay-error" role="alert">
            <p>Couldn&rsquo;t load your earlier conversation.</p>
            <div className="site-chat-replay-actions">
              <button type="button" onClick={retryTranscript} disabled={isLoading}>
                Retry
              </button>
              <button type="button" onClick={onNewChat}>Start new chat</button>
            </div>
          </div>
        )}

        {isEmpty && !isRehydrating && !replayError && (
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
          .map(({ message, text }, index, renderedMessages) => (
            <p key={message.id} className={`site-chat-message is-${message.role}`}>
              {message.role === 'assistant' ? (
                <StreamingText
                  text={text}
                  isStreaming={isLoading && index === renderedMessages.length - 1}
                  onReveal={followLatest}
                  onSiteNavigate={onSiteNavigate}
                />
              ) : text}
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
          rows={2}
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
        {/* Its own row rather than floating over the text, which would leave
            the last line running underneath the button. */}
        <div className="site-chat-actions">
          <button type="submit" className="site-chat-send" disabled={!input.trim() || isLoading || isRehydrating} aria-label="Send">
            {/* The same arrow the scroll-to-top control uses. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
            </svg>
          </button>
        </div>
      </form>
      </div>
    </div>
  )
}
