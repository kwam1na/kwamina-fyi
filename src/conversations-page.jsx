import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import Markdown from 'react-markdown'

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function conversationTitle(conversation) {
  return conversation.first_question?.trim() || 'Conversation without a question'
}

export function filterConversations(conversations, query) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return conversations
  return conversations.filter((conversation) => (
    conversationTitle(conversation).toLocaleLowerCase().includes(needle)
    || conversation.id.toLocaleLowerCase().includes(needle)
  ))
}

export function formatConversationTime(value) {
  return Number.isFinite(value) ? DATE_FORMAT.format(new Date(value)) : 'Unknown time'
}

async function fetchJson(path, signal) {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return response.json()
}

export function createLatestRequestGate() {
  let current = null

  return {
    start() {
      current?.abort()
      current = new AbortController()
      return current
    },
    isCurrent(request) {
      return current === request
    },
    clear(request) {
      if (current === request) current = null
    },
    cancel() {
      current?.abort()
      current = null
    },
  }
}

function ConversationList({ conversations, selectedId, onSelect }) {
  if (!conversations.length) {
    return <p className="conversation-empty">No conversations match this view.</p>
  }

  return (
    <ol className="conversation-list">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <button
            type="button"
            className="conversation-list-item"
            aria-pressed={conversation.id === selectedId}
            onClick={() => onSelect(conversation.id)}
          >
            <span className="conversation-list-title">{conversationTitle(conversation)}</span>
            <span className="conversation-list-meta">
              <time dateTime={new Date(conversation.last_message_at).toISOString()}>
                {formatConversationTime(conversation.last_message_at)}
              </time>
              <span>{conversation.message_count} messages</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function Message({ message }) {
  const isAssistant = message.role === 'assistant'

  return (
    <article className={`conversation-message is-${message.role}`}>
      <header className="conversation-message-header">
        <span>{isAssistant ? 'Assistant' : 'Visitor'}</span>
        <time dateTime={new Date(message.created_at).toISOString()}>
          {formatConversationTime(message.created_at)}
        </time>
      </header>
      <div className="conversation-message-body">
        {isAssistant ? <Markdown>{message.content}</Markdown> : <p>{message.content}</p>}
      </div>
      {(message.page_path || isAssistant) && (
        <footer className="conversation-message-footnote">
          {message.page_path && <span>Asked from {message.page_path}</span>}
          {message.assistant_version && <span>assistant {message.assistant_version}</span>}
          {message.model && <span>{message.model}</span>}
          {Number.isFinite(message.latency_ms) && <span>{message.latency_ms} ms</span>}
        </footer>
      )}
    </article>
  )
}

function Transcript({ detail, isLoading }) {
  if (isLoading) return <p className="conversation-state">Opening conversation…</p>
  if (!detail) return <p className="conversation-state">Select a conversation to read it.</p>

  const { conversation, messages } = detail
  return (
    <>
      <header className="conversation-detail-header">
        <div>
          <p className="conversation-kicker">Selected conversation</p>
          <h2>{messages.find((message) => message.role === 'user')?.content || 'Conversation'}</h2>
        </div>
        <dl className="conversation-detail-facts">
          <div><dt>Source</dt><dd>{conversation.source || 'unknown'}</dd></div>
          <div><dt>Environment</dt><dd>{conversation.environment || 'unknown'}</dd></div>
          <div><dt>Messages</dt><dd>{conversation.message_count}</dd></div>
        </dl>
      </header>
      <div className="conversation-transcript">
        {messages.map((message) => <Message key={message.id} message={message} />)}
      </div>
    </>
  )
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [isCompact, setIsCompact] = useState(() => window.matchMedia('(max-width: 820px)').matches)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [query, setQuery] = useState('')
  const [listState, setListState] = useState('loading')
  const [detailState, setDetailState] = useState('idle')
  const listRequests = useRef(null)
  if (!listRequests.current) listRequests.current = createLatestRequestGate()

  useEffect(() => {
    document.title = 'Conversations — Kwamina Essuah Mensah'
    document.body.classList.add('conversation-archive-open')
    return () => document.body.classList.remove('conversation-archive-open')
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)')
    const onChange = ({ matches }) => {
      setIsCompact(matches)
      if (!matches) setMobileDetailOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const loadList = useCallback(() => {
    const requests = listRequests.current
    const request = requests.start()
    setListState('loading')
    fetchJson('/api/conversations', request.signal)
      .then(({ conversations: next }) => {
        if (!requests.isCurrent(request)) return
        setConversations(next)
        setSelectedId((current) => current && next.some(({ id }) => id === current)
          ? current
          : next[0]?.id ?? null)
        setListState('ready')
      })
      .catch((error) => {
        if (requests.isCurrent(request) && error.name !== 'AbortError') setListState('error')
      })
      .finally(() => requests.clear(request))
  }, [])

  useEffect(() => {
    loadList()
    return () => listRequests.current.cancel()
  }, [loadList])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDetailState('idle')
      return undefined
    }

    const abort = new AbortController()
    setDetailState('loading')
    fetchJson(`/api/conversations/${encodeURIComponent(selectedId)}`, abort.signal)
      .then((next) => {
        setDetail(next)
        setDetailState('ready')
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setDetailState('error')
      })
    return () => abort.abort()
  }, [selectedId])

  const visibleConversations = useMemo(
    () => filterConversations(conversations, query),
    [conversations, query],
  )

  const selectConversation = useCallback((id) => {
    setSelectedId(id)
    if (isCompact) setMobileDetailOpen(true)
  }, [isCompact])

  const mobilePane = mobileDetailOpen ? 'detail' : 'list'

  return (
    <div className={`routed-page conversations-page${isCompact && mobileDetailOpen ? ' is-reading-conversation' : ''}`}>
      <a className="skip-link" href="#conversation-main">Skip to conversations</a>
      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="brand" to="/">kwamina.fyi</Link>
        <Link className="nav-link" to="/about">About</Link>
      </nav>

      <main id="conversation-main" className="conversations-main">
        <header className="conversations-intro">
          <p className="conversation-kicker">Private archive</p>
          <h1>Conversations</h1>
          <p>Read the questions people ask and the answers the site gives back.</p>
        </header>

        <div className="conversations-workspace" data-mobile-pane={mobilePane}>
          <aside className="conversation-index" aria-label="Conversation index">
            <div className="conversation-index-tools">
              <label>
                <span className="visually-hidden">Search conversations</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search conversations"
                />
              </label>
              <button type="button" onClick={loadList}>Refresh</button>
            </div>
            {listState === 'loading' && <p className="conversation-empty">Loading conversations…</p>}
            {listState === 'error' && <p className="conversation-error">Couldn’t load conversations.</p>}
            {listState === 'ready' && (
              <ConversationList
                conversations={visibleConversations}
                selectedId={selectedId}
                onSelect={selectConversation}
              />
            )}
          </aside>

          <section className="conversation-detail" aria-live="polite">
            {isCompact && mobileDetailOpen && (
              <button
                type="button"
                className="conversation-mobile-back"
                onClick={() => setMobileDetailOpen(false)}
              >
                <span aria-hidden="true">←</span>
                All conversations
              </button>
            )}
            {detailState === 'error'
              ? <p className="conversation-error">Couldn’t load this conversation.</p>
              : <Transcript detail={detail} isLoading={detailState === 'loading'} />}
          </section>
        </div>
      </main>
    </div>
  )
}
