export function renderContextForChatMessage(message) {
  return typeof message?.id === 'string' && message.id.startsWith('stored-')
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
    id: `stored-${index}`,
    role: message.role,
    parts: [{ type: 'text', content: message.content }],
  }))
}
