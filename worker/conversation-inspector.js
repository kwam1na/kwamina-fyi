import { isConversationArchiveRouteEnabled } from '../src/routes.js'

const MAX_CONVERSATIONS = 100
const MAX_MESSAGES = 100
const ACCESS_TEAM_DOMAIN_PATTERN = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/
const accessJwksByTeamDomain = new Map()
let josePromise

export function isLocalConversationInspector(requestUrl) {
  const hostname = new URL(requestUrl).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function normalizedAccessTeamDomain(value) {
  const domain = value?.trim().replace(/\/+$/, '')
  return ACCESS_TEAM_DOMAIN_PATTERN.test(domain) ? domain : null
}

async function accessJwks(teamDomain) {
  let jwksPromise = accessJwksByTeamDomain.get(teamDomain)
  if (!jwksPromise) {
    josePromise ??= import('jose')
    jwksPromise = josePromise.then(({ createRemoteJWKSet }) => (
      createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
    ))
    accessJwksByTeamDomain.set(teamDomain, jwksPromise)
  }
  return jwksPromise
}

export async function verifyConversationAccessToken(token, { teamDomain, audience }) {
  josePromise ??= import('jose')
  const [{ jwtVerify }, jwks] = await Promise.all([
    josePromise,
    accessJwks(teamDomain),
  ])
  const { payload } = await jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience,
  })
  return payload
}

export async function conversationInspectorAccess(
  request,
  env,
  verifyToken = verifyConversationAccessToken,
) {
  if (isLocalConversationInspector(request.url)) {
    return { allowed: true, productionOnly: false }
  }

  const denied = { allowed: false, productionOnly: true }
  const hostname = new URL(request.url).hostname
  const teamDomain = normalizedAccessTeamDomain(env.CF_ACCESS_TEAM_DOMAIN)
  const audience = env.CF_ACCESS_AUD?.trim()
  const allowedEmail = env.CF_ACCESS_ALLOWED_EMAIL?.trim().toLowerCase()
  const token = request.headers.get('cf-access-jwt-assertion')

  if (
    !isConversationArchiveRouteEnabled({
      isDevelopment: false,
      enabled: env.CONVERSATION_ARCHIVE_ENABLED === 'true',
      hostname,
      archiveHostname: env.CONVERSATION_ARCHIVE_HOSTNAME,
    })
    || !teamDomain
    || !audience
    || !allowedEmail
    || !token
  ) return denied

  try {
    const payload = await verifyToken(token, { teamDomain, audience })
    return typeof payload.email === 'string'
      && payload.email.toLowerCase() === allowedEmail
      ? { allowed: true, productionOnly: true }
      : denied
  } catch {
    return denied
  }
}

export async function listConversationInspector(db, { productionOnly = false } = {}) {
  const productionScope = productionOnly
    ? "WHERE conversations.source = 'site' AND conversations.environment = 'production'"
    : ''
  const { results } = await db.prepare(`
    SELECT
      conversations.id,
      conversations.created_at,
      conversations.last_message_at,
      conversations.message_count,
      conversations.source,
      conversations.environment,
      (
        SELECT content
        FROM messages
        WHERE messages.conversation_id = conversations.id
          AND messages.role = 'user'
        ORDER BY messages.created_at ASC, messages.id ASC
        LIMIT 1
      ) AS first_question
    FROM conversations
    ${productionScope}
    ORDER BY conversations.last_message_at DESC, conversations.id DESC
    LIMIT ?
  `).bind(MAX_CONVERSATIONS).all()

  return results
}

export async function loadConversationInspector(db, threadId, { productionOnly = false } = {}) {
  const productionScope = productionOnly
    ? "AND source = 'site' AND environment = 'production'"
    : ''
  const conversation = await db.prepare(`
    SELECT id, created_at, last_message_at, message_count, source, environment
    FROM conversations
    WHERE id = ?
    ${productionScope}
  `).bind(threadId).first()
  if (!conversation) return null

  const { results } = await db.prepare(`
    SELECT
      id, role, content, created_at, page_path,
      assistant_version, corpus_version, model, latency_ms
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(threadId, MAX_MESSAGES).all()

  return { conversation, messages: results.reverse() }
}
