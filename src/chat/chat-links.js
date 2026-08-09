import { NAVIGABLE_PATHS } from '../routes.js'

const routeSource = [...NAVIGABLE_PATHS]
  .sort((left, right) => right.length - left.length)
  .map((route) => route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

const chatRoutePattern = new RegExp(
  `(^|[^A-Za-z0-9_:/])(${routeSource})(?![A-Za-z0-9_/-])`,
  'g',
)

const chatLabeledRoutePattern = new RegExp(
  String.raw`\[([^\]\n]+)\]\(\s*(${routeSource})\s*\)`,
  'g',
)

const chatBoldPattern = /\*\*([^*\n]+)\*\*/g

const EMAIL = 'kwami.nuh@gmail.com'
const GITHUB_URL = 'https://github.com/kwam1na'
const LINKEDIN_URL = 'https://linkedin.com/in/ernestmens'
const RESUME_PATH = '/docs/resume.pdf'
const ATHENA_PRODUCT_URL = 'https://athena.wigclub.store/landing'
const ATHENA_REPOSITORY_URL = `${GITHUB_URL}/athena`

const RESOURCE_DESTINATIONS = {
  [RESUME_PATH]: 'Resume',
  [ATHENA_PRODUCT_URL]: 'Athena product overview',
  [ATHENA_REPOSITORY_URL]: 'Athena repository',
}

const resourceSource = Object.keys(RESOURCE_DESTINATIONS)
  .sort((left, right) => right.length - left.length)
  .map((destination) => destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

const chatLabeledResourcePattern = new RegExp(
  String.raw`\[([^\]\n]+)\]\(\s*(${resourceSource})\s*\)`,
  'g',
)

const chatResourcePattern = new RegExp(
  `(^|[^A-Za-z0-9_:/])(${resourceSource})(?![A-Za-z0-9_/-])`,
  'g',
)

const chatLabeledLinkPattern = /\[([^\]\n]+)\]\(\s*[^)\s]+\s*\)/g

const CONTACT_DESTINATIONS = {
  [EMAIL]: `mailto:${EMAIL}`,
  github: GITHUB_URL,
  [GITHUB_URL]: GITHUB_URL,
  linkedin: LINKEDIN_URL,
  [LINKEDIN_URL]: LINKEDIN_URL,
}

const CONTACT_LABELS = {
  [GITHUB_URL]: 'GitHub',
  [LINKEDIN_URL]: 'LinkedIn',
}

const contactLabelUrlPatterns = [
  ['GitHub', GITHUB_URL],
  ['LinkedIn', LINKEDIN_URL],
].map(([label, href]) => new RegExp(
  `(${label})\\s*\\(\\s*${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`,
  'gi',
))

const contactSource = Object.keys(CONTACT_DESTINATIONS)
  .sort((left, right) => right.length - left.length)
  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

const chatContactPattern = new RegExp(
  `(^|[^A-Za-z0-9_])(${contactSource})(?![A-Za-z0-9_@/-])`,
  'gi',
)

function linkParts(text, bold = false) {
  const parts = []
  const matches = []
  let cursor = 0

  for (const match of text.matchAll(chatLabeledRoutePattern)) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: 'link',
      text: match[1],
      to: match[2],
    })
  }

  for (const match of text.matchAll(chatLabeledResourcePattern)) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: 'external-link',
      text: match[1],
      href: match[2],
    })
  }

  for (const match of text.matchAll(chatRoutePattern)) {
    const route = match[2]
    const start = match.index + match[1].length
    matches.push({ start, end: start + route.length, type: 'link', text: route, to: route })
  }

  for (const match of text.matchAll(chatResourcePattern)) {
    const href = match[2]
    const start = match.index + match[1].length
    matches.push({
      start,
      end: start + href.length,
      type: 'external-link',
      text: RESOURCE_DESTINATIONS[href],
      href,
    })
  }

  // Treat every complete Markdown link as one unit. Allowlisted
  // destinations above become links; unsupported destinations keep only their
  // readable label instead of leaking syntax or matching contact names inside
  // the label and URL independently.
  for (const match of text.matchAll(chatLabeledLinkPattern)) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: 'text',
      text: match[1],
    })
  }

  for (const match of text.matchAll(chatContactPattern)) {
    const label = match[2]
    const start = match.index + match[1].length
    matches.push({
      start,
      end: start + label.length,
      type: 'external-link',
      text: CONTACT_LABELS[label.toLowerCase()] ?? label,
      href: CONTACT_DESTINATIONS[label.toLowerCase()],
    })
  }

  matches.sort((left, right) => left.start - right.start || right.end - left.end)

  for (const match of matches) {
    if (match.start < cursor) continue
    if (match.start > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, match.start), ...(bold && { bold: true }) })
    }
    const { start, end, ...part } = match
    parts.push({ ...part, ...(bold && { bold: true }) })
    cursor = end
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor), ...(bold && { bold: true }) })
  }
  return parts
}

export function chatTextParts(text, { hideIncompleteSiteLink = false } = {}) {
  const readableText = hideIncompleteSiteLink
    ? text
      .replace(/\[([^\]\n]+)\]\(\s*[^)\n]*$/, '$1')
      .replace(/\[([^\]\n]*)$/, '$1')
    : text
  const displayText = contactLabelUrlPatterns.reduce(
    (current, pattern) => current.replace(pattern, '$1'),
    readableText,
  )
    // The interface renders exactly two Markdown forms: labeled links and
    // bold. The contract tells the model so, but transcripts show backticks
    // and headings still slipping through occasionally — and everything this
    // renderer does not handle reaches the reader as literal punctuation. The
    // two forms that read as broken are unwrapped here; a stray list dash
    // still reads as prose and is left alone.
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,4} /gm, '')
  const parts = []
  let cursor = 0

  for (const match of displayText.matchAll(chatBoldPattern)) {
    if (match.index > cursor) parts.push(...linkParts(displayText.slice(cursor, match.index)))
    parts.push(...linkParts(match[1], true))
    cursor = match.index + match[0].length
  }

  if (cursor < displayText.length) parts.push(...linkParts(displayText.slice(cursor)))
  return parts
}
