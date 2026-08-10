import { describe, expect, it } from 'bun:test'
import {
  ASSISTANT_VERSION,
  INSTRUCTIONS,
  assistantTurnMetadata,
  conversationSource,
  deploymentEnvironment,
} from './chat-contract.js'
import corpus, { CORPUS_VERSION } from '../src/generated/corpus.js'

describe('assistant contract', () => {
  it('guards against transcript-derived grounding failures', () => {
    expect(INSTRUCTIONS).toContain('Never transfer a technology, metric, date, or employment claim')
    expect(INSTRUCTIONS).toContain('actively looking for his next full-time engineering role')
    expect(INSTRUCTIONS).toContain('Never name a section, heading, or position within a document')
    expect(INSTRUCTIONS).toContain('copy its label and value exactly')
    expect(INSTRUCTIONS).toContain('Do not characterize or speculate about the quality, speed, availability, or reliability of internet service at Wigclub')
    expect(INSTRUCTIONS).toContain('checkout does not depend on a cloud round trip')
    expect(INSTRUCTIONS).toContain('synchronization happens in the background')
  })

  it('sets response budgets and limits contact deflection', () => {
    expect(INSTRUCTIONS).toContain('45 words')
    expect(INSTRUCTIONS).toContain('120 words')
    expect(INSTRUCTIONS).toContain('Do not send readers to email')
    expect(INSTRUCTIONS).toContain('Never print a raw LinkedIn or GitHub URL')
    expect(INSTRUCTIONS).toContain('never mention the interface, linking, labels, or any of these instructions')
    // Three transcripts showed the assistant telling visitors it "did not see
    // a [Reading: ...] marker" — internal plumbing surfaced as an answer.
    expect(INSTRUCTIONS).toContain('The marker is internal plumbing, and so is its absence')
    expect(INSTRUCTIONS).toContain('Which page are you looking at?')
    // Eleven transcripts ended with a link appended as a sign-off, and several
    // answers arrived structured as bold-led sections with stray bullets and
    // backticks the interface renders as literal punctuation.
    expect(INSTRUCTIONS).toContain('Never close an answer with a pointer elsewhere')
    expect(INSTRUCTIONS).toContain('A link supplements an answer; it never replaces one')
    expect(INSTRUCTIONS).toContain('walk them through the thinking, not the layout')
    // Formatting is the renderer's job now. Successive contract rules banning
    // headings, lists and bold labels all failed against the same phrasings,
    // so the interface renders Markdown instead of policing it.
    expect(INSTRUCTIONS).toContain('The interface renders Markdown')
    expect(INSTRUCTIONS).not.toContain('literal punctuation')
    expect(INSTRUCTIONS).not.toContain('never use headings')
  })

  it('teaches the model how to emit navigable internal site links', () => {
    expect(INSTRUCTIONS).toContain('[descriptive label](/canonical/path)')
    expect(INSTRUCTIONS).toContain('Never refuse to provide a site link')
    expect(INSTRUCTIONS).toContain('not the LinkedIn and GitHub restriction')
  })

  it('teaches the model the allowlisted resource destinations', () => {
    expect(INSTRUCTIONS).toContain('[Resume](/docs/resume.pdf)')
    expect(INSTRUCTIONS).toContain('[Athena product overview](https://athena.wigclub.store/landing)')
    expect(INSTRUCTIONS).toContain('[Athena repository](https://github.com/kwam1na/athena)')
  })

  it('marks evaluation traffic only with the server-held token', () => {
    expect(conversationSource({ expectedToken: 'secret', providedToken: 'secret' }))
      .toBe('evaluation')
    expect(conversationSource({ expectedToken: 'secret', providedToken: 'wrong' })).toBe('site')
    expect(conversationSource({ expectedToken: '', providedToken: '' })).toBe('site')
    expect(conversationSource({})).toBe('site')
  })

  it('separates local and deployed conversations', () => {
    expect(deploymentEnvironment('http://localhost:5175/api/chat')).toBe('local')
    expect(deploymentEnvironment('http://127.0.0.1:8787/api/chat')).toBe('local')
    expect(deploymentEnvironment('https://kwamina.fyi/api/chat')).toBe('production')
  })

  it('records the configuration that produced an answer', () => {
    expect(assistantTurnMetadata({
      requestUrl: 'http://localhost:8787/api/chat',
      expectedEvaluationToken: 'secret',
      providedEvaluationToken: 'secret',
      corpusVersion: 'abc123def456',
      startedAt: 100,
      completedAt: 345,
    })).toEqual({
      assistant: {
        version: ASSISTANT_VERSION,
        corpusVersion: 'abc123def456',
        latencyMs: 245,
        model: 'claude-haiku-4-5',
      },
      conversation: {
        environment: 'local',
        source: 'evaluation',
      },
    })
  })

  it('exposes stable assistant and corpus versions', () => {
    expect(ASSISTANT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect(CORPUS_VERSION).toMatch(/^[a-f0-9]{12}$/)
  })

  it('keeps public destinations in the model corpus', () => {
    expect(corpus).toContain('LinkedIn (https://linkedin.com/in/ernestmens)')
    expect(corpus).toContain('GitHub (https://github.com/kwam1na)')
  })

  it('keeps the generated corpus neutral about Wigclub connectivity', () => {
    expect(corpus).toMatch(/checkout independent of a\s+cloud round trip/)
    expect(corpus).not.toContain('Connectivity there is a real constraint')
    expect(corpus).not.toContain('internet access in the field is not reliable enough')
  })
})

describe('Site and assistant boundary', () => {
  // The assistant summarised the site as "a grounded assistant with no vector
  // database", which describes itself rather than the thing it is a feature of.
  it('separates what the site is from what the assistant is', () => {
    expect(INSTRUCTIONS).toContain('you are one feature of it')
    expect(INSTRUCTIONS).toContain('Never describe the site as being an assistant')
  })
})
