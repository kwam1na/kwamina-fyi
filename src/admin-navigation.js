const conversationArchiveHref = '/conversations'

export function addConversationArchiveEntry(body, enabled) {
  if (!enabled || /href=["']\/conversations["']/i.test(body)) return body

  return body.replace(
    /(<nav\b[^>]*class=["'][^"']*\bsite-nav\b[^"']*["'][^>]*>[\s\S]*?)(<\/nav>)/i,
    `$1\n    <a class="nav-link admin-nav-entry" href="${conversationArchiveHref}">CONVERSATIONS</a>\n  $2`,
  )
}
