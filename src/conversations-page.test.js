import { describe, expect, it } from 'bun:test'
import {
  conversationTitle,
  createLatestRequestGate,
  filterConversations,
  formatConversationTime,
} from './conversations-page.jsx'

const conversations = [
  { id: 'thread-alpha', first_question: 'How is Athena built?' },
  { id: 'thread-beta', first_question: 'What is his background?' },
]

describe('conversationTitle', () => {
  it('falls back when a conversation has no visitor question', () => {
    expect(conversationTitle({ first_question: '  Hello  ' })).toBe('Hello')
    expect(conversationTitle({ first_question: null })).toBe('Conversation without a question')
  })
})

describe('filterConversations', () => {
  it('matches questions and identifiers without changing the source list', () => {
    expect(filterConversations(conversations, 'athena')).toEqual([conversations[0]])
    expect(filterConversations(conversations, 'BETA')).toEqual([conversations[1]])
    expect(filterConversations(conversations, '')).toBe(conversations)
  })
})

describe('formatConversationTime', () => {
  it('handles missing timestamps without producing an invalid date', () => {
    expect(formatConversationTime(undefined)).toBe('Unknown time')
    expect(formatConversationTime(0)).not.toBe('Unknown time')
  })
})

describe('createLatestRequestGate', () => {
  it('cancels an older request and accepts state only from the latest request', () => {
    const requests = createLatestRequestGate()
    const first = requests.start()
    const second = requests.start()

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(requests.isCurrent(first)).toBe(false)
    expect(requests.isCurrent(second)).toBe(true)

    requests.clear(first)
    expect(requests.isCurrent(second)).toBe(true)

    requests.clear(second)
    expect(requests.isCurrent(second)).toBe(false)
  })

  it('cancels the active request when the page unmounts', () => {
    const requests = createLatestRequestGate()
    const active = requests.start()

    requests.cancel()

    expect(active.signal.aborted).toBe(true)
    expect(requests.isCurrent(active)).toBe(false)
  })
})
