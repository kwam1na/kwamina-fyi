// Builds docs/resume.docx, the resume's editable source, which
// scripts/build-resume.sh then renders to the PDF the site serves.
//
// This file is where the resume's content lives. Editing the .docx in Word or
// Pages works and is the faster path for a one-line fix, but this script
// overwrites it wholesale on the next run, so a change worth keeping belongs
// here. Everything downstream is generated: content here, .docx from this,
// .pdf from that.
//
// The layout is shaped by the renderer rather than by taste. Pages, which is
// what renders the PDF on macOS, drops three things on .docx import: tab
// stops, paragraph borders, and paragraph alignment applied as direct
// formatting. So dates sit in borderless table columns instead of on a right
// tab stop, section rules are a table's bottom border instead of a paragraph
// border, and centring comes from named paragraph styles, which it does
// honour. Word renders all three the same way, so the file stays portable.

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, LevelFormat, Packer, Paragraph, Table,
  TableCell, TableRow, TextRun, UnderlineType, VerticalAlign, WidthType,
} from 'docx'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(root, 'docs/resume.docx')

const FONT = 'Helvetica Neue'
const INK = '1A1A1A'
const MUTED = '555555'

const base = { font: FONT, size: 18, color: INK } // 9.5pt

const bullets = {
  config: [{
    reference: 'resume-bullets',
    levels: [{
      level: 0,
      format: LevelFormat.BULLET,
      text: '•',
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 260, hanging: 160 } } },
    }],
  }],
}

// Links keep the surrounding ink colour and carry a thin underline: a resume
// reads as a document, not a web page, but a hiring reader should still see
// which names are clickable.
function link(url, runProps) {
  return new ExternalHyperlink({
    link: url,
    children: [new TextRun({
      ...base,
      ...runProps,
      underline: { type: UnderlineType.SINGLE, color: runProps.color ?? INK },
    })],
  })
}

const TEXT_WIDTH = 11130 // page width 12240 - 2 * 555 margins
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const CELL_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 }

// Pages (the renderer on this machine) drops paragraph tab stops and borders
// when importing docx, so headings and title/date rows are tables instead.
function heading(text) {
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: [TEXT_WIDTH],
    borders: { top: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' } },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: TEXT_WIDTH, type: WidthType.DXA },
        margins: CELL_MARGINS,
        children: [new Paragraph({
          spacing: { before: 60, after: 0 },
          children: [new TextRun({ ...base, text: text.toUpperCase(), bold: true, size: 19 })],
        })],
      })],
    })],
  })
}

function role(title, dates, url) {
  const titleWidth = 8130
  const dateWidth = TEXT_WIDTH - titleWidth
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: [titleWidth, dateWidth],
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: titleWidth, type: WidthType.DXA },
          margins: CELL_MARGINS,
          verticalAlign: VerticalAlign.BOTTOM,
          children: [new Paragraph({
            spacing: { before: 30, after: 0 },
            children: [url
              ? link(url, { text: title, bold: true, size: 19 })
              : new TextRun({ ...base, text: title, bold: true, size: 19 })],
          })],
        }),
        new TableCell({
          width: { size: dateWidth, type: WidthType.DXA },
          margins: CELL_MARGINS,
          verticalAlign: VerticalAlign.BOTTOM,
          children: [new Paragraph({
            style: "RightAligned",
            alignment: AlignmentType.RIGHT,
            spacing: { before: 30, after: 0 },
            children: [new TextRun({ ...base, text: dates, color: MUTED, size: 17 })],
          })],
        }),
      ],
    })],
  })
}

function note(text) {
  return new Paragraph({
    spacing: { after: 20 },
    children: [new TextRun({ ...base, text, italics: true, color: MUTED, size: 17 })],
  })
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'resume-bullets', level: 0 },
    spacing: { after: 20 },
    children: [new TextRun({ ...base, text })],
  })
}

function para(runs) {
  return new Paragraph({
    spacing: { after: 40 },
    children: runs.map((r) => new TextRun({ ...base, ...r })),
  })
}

const doc = new Document({
  title: 'Resume — Kwamina Essuah Mensah',
  creator: 'Kwamina Essuah Mensah',
  lastModifiedBy: 'Kwamina Essuah Mensah',
  numbering: bullets,
  styles: {
    default: { document: { run: base, paragraph: { spacing: { line: 238 } } } },
    paragraphStyles: [
      { id: "Centered", name: "Centered", basedOn: "Normal", paragraph: { alignment: AlignmentType.CENTER } },
      { id: "RightAligned", name: "Right Aligned", basedOn: "Normal", paragraph: { alignment: AlignmentType.RIGHT } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 480, bottom: 480, left: 555, right: 555 },
      },
    },
    children: [
      // Centered via a full-width table cell: Pages drops plain paragraph
      // alignment on docx import, the same way it drops tab stops and borders.
      new Table({
        width: { size: TEXT_WIDTH, type: WidthType.DXA },
        columnWidths: [TEXT_WIDTH],
        borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
        rows: [new TableRow({
          children: [new TableCell({
            width: { size: TEXT_WIDTH, type: WidthType.DXA },
            margins: CELL_MARGINS,
            children: [
              new Paragraph({
                style: "Centered",
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ ...base, text: 'Ernest Essuah Mensah', bold: true, size: 38 })],
              }),
              new Paragraph({
                style: "Centered",
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ ...base, text: 'Senior Product Engineer | Production AI & Agent Systems', bold: true, size: 19 })],
              }),
              new Paragraph({
                style: "Centered",
                alignment: AlignmentType.CENTER,
                spacing: { after: 40 },
                children: [
                  new TextRun({ ...base, color: MUTED, size: 17, text: 'Laurel, MD · (443) 805-3963 · ' }),
                  link('mailto:kwami.nuh@gmail.com', { text: 'kwami.nuh@gmail.com', color: MUTED, size: 17 }),
                  new TextRun({ ...base, color: MUTED, size: 17, text: ' · ' }),
                  link('https://kwamina.fyi', { text: 'kwamina.fyi', color: MUTED, size: 17 }),
                  new TextRun({ ...base, color: MUTED, size: 17, text: ' · ' }),
                  link('https://linkedin.com/in/kwamina-em', { text: 'linkedin.com/in/kwamina-em', color: MUTED, size: 17 }),
                  new TextRun({ ...base, color: MUTED, size: 17, text: ' · ' }),
                  link('https://github.com/kwam1na', { text: 'github.com/kwam1na', color: MUTED, size: 17 }),
                ],
              }),
            ],
          })],
        })],
      }),

      heading('Summary'),
      para([{ text: 'Senior product engineer who builds and ships reliable systems end to end, with particular depth in production LLM applications and the agent-ready infrastructure that makes AI-assisted development safe, observable, and verifiable.' }]),

      heading('Experience'),

      role('Sole Product Engineer — Athena', 'Mar 2026 – Present', 'https://athena-os.app/landing'),
      note('Business operating system for retail and service businesses, in production for Wigclub (Ghana)'),
      bullet('Built and operate the full TypeScript system across point-of-sale, online storefront, inventory, payments, and service operations; production now manages 1,800+ SKUs and has processed 1,100+ completed POS transactions.'),
      bullet('Architected the POS local-first: the register reads and writes to on-device storage so checkout never blocks on the network, with a sync layer that reconciles sales to the backend and preserves ordering across concurrent registers.'),
      bullet('Built an agent-ready delivery harness spanning 35 validation surfaces across three apps, combining generated repo maps, deterministic and LLM-based reviews, runtime evidence, and drift sensors; a recorded five-phase merge-grade run completed in under 10 minutes with zero duplicate commands.'),
      bullet('Built the deployment pipeline: one-command deploys to a VPS behind Cloudflare Tunnel, automatic QA deploys on every merge, and instant rollback to any previous release.'),

      role('Product & AI Engineer — kwamina.fyi (Independent Project)', '2026', 'https://kwamina.fyi'),
      note('React 19, Cloudflare Workers, D1, Claude'),
      bullet('Built a site assistant grounded by construction: published pages compile into a versioned, prompt-cached corpus, so it can never claim anything a visitor can’t read; vector retrieval deliberately deferred behind a measured token budget.'),
      bullet('Engineered honest streaming: tokens render immediately, but the success signal waits for the database commit; history is server-authoritative so a tampered client can’t rewrite what the model sees.'),
      bullet('Privacy-first observability (one sanitization contract across browser, worker, and analytics; allowlisted telemetry) held by ~200 tests, including a Python suite validating the content itself, and a scheduled production canary.'),

      role('Senior Software Engineer — Eventbrite', 'Mar 2022 – 2026 · Remote'),
      note('Promoted SWE I → SWE II (2023) → Senior (2025)'),
      bullet('Technical lead and main implementer of Dashy, Eventbrite’s AI-powered Event Dashboard Assistant (Amazon Bedrock). Owned it end-to-end: hardened chat BFF routes (auth, validation, rate limiting, streaming), lifecycle-grounded prompts and guardrails, and CSAT collection.'),
      bullet('Pioneered an agentic AI development workflow that scaffolded requirements, tickets, and code, cutting feature delivery from weeks to days; taught it at internal engineering forums.'),
      bullet('Core engineer on the migration of the legacy Event Dashboard to a modern Next.js stack: routing, permissions, analytics parity, and feature-flagged rollout with documented rollback. Built the error-recovery layer that eliminated 8+ second full-page reloads during backend failures.'),
      bullet('Led fraud prevention across subscription and checkout payment flows with Stripe Radar, cutting fraudulent payments 65% within three months; implemented 3D Secure/SCA verification, unblocking subscriptions for customers across the EU and India.'),
      bullet('Championed nonprofit plan automation beyond the team’s roadmap, replacing an error-prone manual back-office process and auto-enrolling ~3,200 verified NPOs into discounted plans at launch.'),
      bullet('Built core Stripe billing services and infrastructure (Terraform-provisioned API Gateway with WAF, Lambda, DynamoDB, webhook processing, refund and proration endpoints), raising payment-service test coverage from 58% to 90%+.'),
      bullet('Shipped a logged-out event-creation flow that removed account signup as a prerequisite to building an event, lifting event creation +26.6%, event publishing +5.4%, and transactions +2.2%.'),

      para([
        { text: 'Apple, Software Engineering Intern', bold: true },
        { text: ' (Jun – Nov 2021): migrated Java API test suites to Karate, cutting build and test times by 20%; expanded coverage of OS-services APIs by 40%+.' },
      ]),
      para([
        { text: 'University of Maryland iSchool, Research Software Engineer', bold: true },
        { text: ' (Dec 2019 – May 2021): built the UI of a teachable object recognizer helping blind users identify objects; co-authored papers presented at ACM ASSETS and CHI.' },
      ]),

      heading('Education'),
      role('Bachelor of Science in Computer Science, University of Maryland, College Park', 'May 2021'),

      heading('Skills'),
      para([
        { text: 'Application engineering: ', bold: true },
        { text: 'TypeScript, Python, Node.js, React, Next.js, Tailwind, Tanstack · ' },
        { text: 'AI systems: ', bold: true },
        { text: 'Production LLM applications, grounding and context engineering, prompt engineering and guardrails, streaming, LLM evaluation, AI observability · ' },
        { text: 'Agent engineering: ', bold: true },
        { text: 'Agent-ready repositories, multi-agent orchestration, tool and skill design, deterministic and LLM-based review harnesses · ' },
        { text: 'Payments & risk: ', bold: true },
        { text: 'Stripe, Radar, 3D Secure/SCA · ' },
        { text: 'Cloud, data & delivery: ', bold: true },
        { text: 'AWS, Cloudflare Workers/D1, Convex, PostgreSQL, Valkey/Redis, Terraform, CI/CD' },
      ]),
    ],
  }],
})

await writeFile(outputPath, await Packer.toBuffer(doc))
console.log('build-resume-docx: wrote docs/resume.docx')
