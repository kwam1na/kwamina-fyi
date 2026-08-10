const STORED_MESSAGE_ID_PREFIX = 'stored-'

export function renderContextForChatMessage(message) {
  return typeof message?.id === 'string' && message.id.startsWith(STORED_MESSAGE_ID_PREFIX)
    ? 'replay_render'
    : 'live_render'
}

export async function fetchStoredMessages(threadId, { signal, fetcher = fetch } = {}) {
  const response = await fetcher('/api/chat/transcript', {
    signal,
    headers: { 'x-chat-thread-id': threadId },
  })
  if (!response.ok) throw new Error('Could not load the conversation.')

  const data = await response.json()
  return (data.messages ?? []).map((message, index) => ({
    id: `${STORED_MESSAGE_ID_PREFIX}${index}`,
    role: message.role,
    parts: [{ type: 'text', content: message.content }],
  }))
}
