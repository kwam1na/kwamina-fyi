const STORED_MESSAGE_ID_PREFIX = 'stored-'

export function renderContextForChatMessage(message) {
  return typeof message?.id === 'string' && message.id.startsWith(STORED_MESSAGE_ID_PREFIX)
    ? 'replay_render'
    : 'live_render'
}

export function memoryStateFromResponse(response) {
  let memory = null
  const encodedMemory = response.headers.get('x-chat-memory')
  if (encodedMemory) {
    try {
      memory = JSON.parse(decodeURIComponent(encodedMemory))
    } catch {
      memory = null
    }
  }
  const oldestMessageId = Number(response.headers.get('x-chat-oldest-message-id'))
  return {
    memory,
    hasEarlierMessages: response.headers.get('x-chat-has-earlier-messages') === 'true',
    memoryUnavailable: response.headers.get('x-chat-memory-status') === 'unavailable',
    oldestMessageId: Number.isSafeInteger(oldestMessageId) && oldestMessageId > 0
      ? oldestMessageId
      : null,
  }
}

export async function fetchStoredMessages(threadId, { signal, fetcher = fetch } = {}) {
  const response = await fetcher('/api/chat/transcript', {
    signal,
    headers: { 'x-chat-thread-id': threadId },
  })
  if (!response.ok) throw new Error('Could not load the conversation.')

  const data = await response.json()
  return {
    memory: data.memory ?? null,
    hasEarlierMessages: Boolean(data.hasEarlierMessages),
    memoryUnavailable: Boolean(data.memoryUnavailable),
    oldestMessageId: Number.isSafeInteger(data.oldestMessageId) ? data.oldestMessageId : null,
    messages: (data.messages ?? []).map((message, index) => ({
      id: `${STORED_MESSAGE_ID_PREFIX}${message.id ?? index}`,
      role: message.role,
      parts: [{ type: 'text', content: message.content }],
    })),
  }
}

export async function fetchEarlierMessages(threadId, {
  beforeId,
  signal,
  fetcher = fetch,
} = {}) {
  const response = await fetcher(`/api/chat/history?before=${encodeURIComponent(beforeId)}`, {
    signal,
    headers: { 'x-chat-thread-id': threadId },
  })
  if (!response.ok) throw new Error('Could not load earlier messages.')
  return response.json()
}
