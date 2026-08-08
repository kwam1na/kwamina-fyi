const MIN_REVEAL_MS = 70
const MAX_STREAM_REVEAL_MS = 180
const MAX_SETTLE_REVEAL_MS = 120

export function revealDuration(pendingCharacters, isStreaming) {
  if (pendingCharacters <= 0) return 0

  const pace = isStreaming ? 10 : 6
  const maximum = isStreaming ? MAX_STREAM_REVEAL_MS : MAX_SETTLE_REVEAL_MS
  return Math.min(maximum, Math.max(MIN_REVEAL_MS, pendingCharacters * pace))
}

export function revealedPrefix(text, characterCount) {
  return Array.from(text).slice(0, Math.max(0, Math.floor(characterCount))).join('')
}
