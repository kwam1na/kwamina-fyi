import { describe, expect, it } from 'bun:test'
import { chatTextParts, classifyChatHref } from './chat-links.js'

describe('classifyChatHref', () => {
  it('classifies canonical routes from the shared navigable-path set', () => {
    expect(classifyChatHref('/work/athena')).toEqual({
      kind: 'route',
      to: '/work/athena',
    })
  })

  it('keeps invented routes as text', () => {
    expect(classifyChatHref('/not-a-page')).toEqual({ kind: 'text' })
  })
})

describe('chatTextParts', () => {
  it('renders labeled canonical site links without exposing their route paths', () => {
    expect(chatTextParts(
      'Read [The Athena story](/work/athena) or [Local-first point of sale](/work/athena/local-first-pos).',
    )).toEqual([
      { type: 'text', text: 'Read ' },
      { type: 'link', text: 'The Athena story', to: '/work/athena' },
      { type: 'text', text: ' or ' },
      {
        type: 'link',
        text: 'Local-first point of sale',
        to: '/work/athena/local-first-pos',
      },
      { type: 'text', text: '.' },
    ])
  })

  it('renders the resume and Athena product overview as first-class resource links', () => {
    expect(chatTextParts(
      'View his [resume](/docs/resume.pdf) or [view the product](https://athena-os.app/landing).',
    )).toEqual([
      { type: 'text', text: 'View his ' },
      { type: 'external-link', text: 'resume', href: '/docs/resume.pdf' },
      { type: 'text', text: ' or ' },
      {
        type: 'external-link',
        text: 'view the product',
        href: 'https://athena-os.app/landing',
      },
      { type: 'text', text: '.' },
    ])
  })

  it('renders the Athena repository as one first-class link', () => {
    expect(chatTextParts(
      'The [GitHub repository](https://github.com/kwam1na/athena) is authoritative.',
    )).toEqual([
      { type: 'text', text: 'The ' },
      {
        type: 'external-link',
        text: 'GitHub repository',
        href: 'https://github.com/kwam1na/athena',
      },
      { type: 'text', text: ' is authoritative.' },
    ])
  })

  it('keeps unsupported Markdown links atomic instead of linking words inside them', () => {
    expect(chatTextParts(
      'Read the [GitHub guide](https://example.com/github) for more.',
    )).toEqual([
      { type: 'text', text: 'Read the ' },
      { type: 'text', text: 'GitHub guide' },
      { type: 'text', text: ' for more.' },
    ])
  })

  it('uses concise labels when resource destinations are returned without Markdown', () => {
    expect(chatTextParts(
      'Open /docs/resume.pdf or https://athena-os.app/landing.',
    )).toEqual([
      { type: 'text', text: 'Open ' },
      { type: 'external-link', text: 'Resume', href: '/docs/resume.pdf' },
      { type: 'text', text: ' or ' },
      {
        type: 'external-link',
        text: 'Athena product overview',
        href: 'https://athena-os.app/landing',
      },
      { type: 'text', text: '.' },
    ])
  })

  it('keeps only the readable label for unknown site paths', () => {
    expect(chatTextParts('Read [A missing page](/not-a-page).')).toEqual([
      { type: 'text', text: 'Read ' },
      { type: 'text', text: 'A missing page' },
      { type: 'text', text: '.' },
    ])
  })

  it('keeps an in-progress labeled link readable without flashing its route syntax', () => {
    expect(chatTextParts(
      'Read [The Athena story](/work/athe',
      { hideIncompleteSiteLink: true },
    )).toEqual([
      { type: 'text', text: 'Read The Athena story' },
    ])
  })

  it('turns canonical site paths into link parts without swallowing punctuation', () => {
    expect(chatTextParts('Read /work/athena, then /about.')).toEqual([
      { type: 'text', text: 'Read ' },
      { type: 'link', text: '/work/athena', to: '/work/athena' },
      { type: 'text', text: ', then ' },
      { type: 'link', text: '/about', to: '/about' },
      { type: 'text', text: '.' },
    ])
  })

  it('prefers the longest canonical route and leaves unknown paths alone', () => {
    expect(chatTextParts('See /work/athena/read-optimized-reporting or /not-a-page.')).toEqual([
      { type: 'text', text: 'See ' },
      {
        type: 'link',
        text: '/work/athena/read-optimized-reporting',
        to: '/work/athena/read-optimized-reporting',
      },
      { type: 'text', text: ' or /not-a-page.' },
    ])
  })

  it('does not reinterpret a path inside an external URL', () => {
    expect(chatTextParts('External: https://example.com/work/athena.')).toEqual([
      { type: 'text', text: 'External: https://example.com/work/athena.' },
    ])
  })

  it('links contact mentions to the published destinations', () => {
    expect(chatTextParts('Email kwami.nuh@gmail.com or find him on GitHub and LinkedIn.')).toEqual([
      { type: 'text', text: 'Email ' },
      {
        type: 'external-link',
        text: 'kwami.nuh@gmail.com',
        href: 'mailto:kwami.nuh@gmail.com',
      },
      { type: 'text', text: ' or find him on ' },
      { type: 'external-link', text: 'GitHub', href: 'https://github.com/kwam1na' },
      { type: 'text', text: ' and ' },
      {
        type: 'external-link',
        text: 'LinkedIn',
        href: 'https://linkedin.com/in/ernestmens',
      },
      { type: 'text', text: '.' },
    ])
  })

  it('renders profile URLs as labels instead of exposing their destinations', () => {
    expect(chatTextParts('Profiles: https://github.com/kwam1na and https://linkedin.com/in/ernestmens.')).toEqual([
      { type: 'text', text: 'Profiles: ' },
      {
        type: 'external-link',
        text: 'GitHub',
        href: 'https://github.com/kwam1na',
      },
      { type: 'text', text: ' and ' },
      {
        type: 'external-link',
        text: 'LinkedIn',
        href: 'https://linkedin.com/in/ernestmens',
      },
      { type: 'text', text: '.' },
    ])
  })

  it('collapses a destination printed behind its matching label', () => {
    expect(chatTextParts(
      'Find him on LinkedIn (https://linkedin.com/in/ernestmens) and GitHub (https://github.com/kwam1na).',
    )).toEqual([
      { type: 'text', text: 'Find him on ' },
      {
        type: 'external-link',
        text: 'LinkedIn',
        href: 'https://linkedin.com/in/ernestmens',
      },
      { type: 'text', text: ' and ' },
      { type: 'external-link', text: 'GitHub', href: 'https://github.com/kwam1na' },
      { type: 'text', text: '.' },
    ])
  })

  it('recognises the homepage only when the slash stands alone', () => {
    expect(chatTextParts('Start at / or compare and/or.')).toEqual([
      { type: 'text', text: 'Start at ' },
      { type: 'link', text: '/', to: '/' },
      { type: 'text', text: ' or compare and/or.' },
    ])
  })

  it('turns paired emphasis markers into bold text parts', () => {
    expect(chatTextParts('Read **Local-first point of sale** next.')).toEqual([
      { type: 'text', text: 'Read ' },
      { type: 'text', text: 'Local-first point of sale', bold: true },
      { type: 'text', text: ' next.' },
    ])
  })

  it('keeps canonical routes navigable inside bold text', () => {
    expect(chatTextParts('Open **/work/athena**.')).toEqual([
      { type: 'text', text: 'Open ' },
      { type: 'link', text: '/work/athena', to: '/work/athena', bold: true },
      { type: 'text', text: '.' },
    ])
  })

  it('leaves unmatched emphasis markers as literal text', () => {
    expect(chatTextParts('Keep **unfinished emphasis literal.')).toEqual([
      { type: 'text', text: 'Keep **unfinished emphasis literal.' },
    ])
  })

  it('unwraps the markdown the interface cannot render', () => {
    // The contract bans these, but transcripts show them slipping through —
    // and a backtick or heading hash reaches the reader as broken punctuation.
    expect(chatTextParts('The `reportsContract.ts` file.')).toEqual([
      { type: 'text', text: 'The reportsContract.ts file.' },
    ])
    expect(chatTextParts('## Athena\nA business OS.')).toEqual([
      { type: 'text', text: 'Athena\nA business OS.' },
    ])
  })
})
