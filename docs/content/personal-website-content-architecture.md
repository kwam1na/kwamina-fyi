# Personal Website Content Architecture

## Purpose

This document translates the approved site structure into a page-by-page content blueprint.
It is not final copy and does not decide visual design.
It defines what each page must accomplish, which proof points it should carry, and how the pages should relate to each other.

Source of truth for structure: [Personal Website - Plan](../plans/2026-07-07-001-product-personal-website-plan.md).

## Content Strategy

The site should make a hiring reader understand Kwamina's engineering identity quickly, then reward deeper reading with reflective proof.

The central message:

> I build systems that turn messy operational reality into trustworthy software loops.

The content should feel authored, precise, and grounded.
It should avoid broad claims unless the page can show the work behind them.

## Voice Rules

- Lead with engineering judgment, not biography.
- Write in first person where it clarifies ownership or reflection.
- Prefer concrete operating conditions over abstract values.
- Use metrics when they are public-safe and meaningful.
- Keep personal context in service of craft, not as the main story.
- Avoid resume-bullet language on essay pages.
- Avoid making Athena sound like a demo or hobby app.
- Avoid making Eventbrite sound like a disconnected work-history section.

## Global Navigation Model

Primary anchors on the homepage:

- Work
- Athena
- Eventbrite
- Principles
- Notes
- Contact

Persistent links:

- Resume
- GitHub
- LinkedIn
- Email

Deep-page navigation should always provide a path back to:

- Homepage
- Athena index/main essay when inside Athena pages
- Eventbrite work section when inside Eventbrite pages

## Homepage

### Page Job

The homepage must tell the full story in a short read.
It should establish the craft thesis, present Athena as the flagship proof, show Eventbrite as professional depth, extract working principles, and make contact easy.

### Reader Promise

After reading the homepage, a hiring reader should know what kind of engineer Kwamina is, what he has built, what he values in software, and where to go for deeper evidence.

### Section Order

1. Hero / thesis
2. Athena flagship preview
3. Eventbrite work previews
4. How I work
5. Formation
6. Notes / learnings
7. Contact / resume

### Hero / Thesis

Purpose:
Establish the craft lens before the work inventory appears.

Required content:

- A scene-like opening sentence about software failing in the places users depend on.
- A direct thesis about building systems that hold up in real operating conditions.
- A short scope sentence naming Athena, Eventbrite, production systems, product surfaces, and AI/workflow learning.
- CTAs for work, resume, and contact.

Candidate hook direction:

> A product can look finished and still fail where users need it most.

Candidate thesis direction:

> I build software systems that hold up in real operating conditions: product-minded, production-ready, and shaped by the details that make people trust what they are using.

Avoid:

- "Hi, I'm Kwamina" as the main headline.
- A long paragraph about origin or personality.
- Generic phrases like "passionate full-stack engineer."

### Athena Preview

Purpose:
Make Athena the clearest expression of current craft.

Content blocks:

- Eyebrow: Flagship project
- Title: Athena
- Subtitle: Production business OS for owner-operated retail and service businesses
- Narrative preview
- Proof chips
- Links to main essay and sub-essays

Homepage framing:

Athena is a production business OS for owner-operated retail and service businesses.
It brings POS, storefront checkout, inventory, procurement, cash controls, daily close, staff work, services, analytics, and operational evidence into one control loop.
It is built for businesses where the owner needs clearer visibility, stronger controls, and a trustworthy record of daily operations.

Proof chips:

- Business OS
- Local-first POS
- Inventory and procurement
- Cash controls
- Daily close
- Storefront checkout
- Production deploys
- Observability
- Agent-ready repo

Links:

- Read the main essay
- Local-first POS
- Production system
- Agent-ready repo

Avoid:

- Naming Wigclub on the homepage.
- Over-explaining the business origin.
- Positioning Athena as a "side project."

### Eventbrite Preview

Purpose:
Show professional depth and prove the same craft principles inside a larger product organization.

Intro framing:

Eventbrite should be framed as the place where Kwamina applied the same instincts to larger systems: creator tooling, monetization, payments, dashboard modernization, AI guidance, instrumentation, and rollout safety.

Preview order:

1. Dashy
2. Event Dashboard migration
3. Payments, fraud, and billing reliability
4. NPO plan enrollment automation

Each preview should include:

- Title
- One-sentence thesis
- Short narrative preview
- Signal chips
- "Read the essay" link

Avoid:

- Listing every Jira/PR detail on the homepage.
- Making the section look like a resume timeline.
- Leading with metrics before context.

### How I Work

Purpose:
Turn the proof into explicit principles without becoming abstract.

Principles:

1. Build around operational trust.
2. Make systems observable.
3. Treat rollout and rollback as product work.
4. Automate through evidence and authority boundaries.
5. Learn domains deeply enough to improve them.

Each principle should include:

- One sentence of belief.
- One grounding example from Athena or Eventbrite.

Avoid:

- Values without evidence.
- Generic engineering maxims.

### Formation

Purpose:
Provide compact credibility context.

Content blocks:

- Education
- Early career acceleration
- Eventbrite growth arc
- Current focus on Athena and engineering workflows

Tone:
Factual, compressed, and craft-relevant.

Avoid:

- Full biography.
- Over-indexing on personal background.
- Repeating the resume.

### Notes / Learnings

Purpose:
Show reflection and current thinking.

V1 item:

- How AI Changes Engineering Workflows When The Codebase Is Ready

Homepage teaser:

AI's deepest impact on engineering is not only faster patches.
It changes what a codebase has to provide: legible structure, clear validation, observable behavior, reviewable evidence, and recovery loops.

Avoid:

- Making the whole site feel AI-branded.
- Overclaiming AI outcomes.

### Contact / Resume

Purpose:
Make the next step obvious.

Required links:

- Resume
- Email
- GitHub
- LinkedIn

Optional line:

Currently interested in roles and collaborations where product judgment, production systems, and careful engineering craft matter.

## Athena Main Essay: `/work/athena`

### Working Title

Athena: Building Software Around Operational Trust

### Page Job

Explain Athena as the flagship expression of Kwamina's craft.
The essay should establish the product, origin, ambition, operating constraints, and the core engineering philosophy.

### Reader Promise

The reader should leave understanding that Athena is a real production system built from a real operator visibility/control problem, and that the work reflects product judgment, systems thinking, and production ownership.

### Section Outline

1. Opening thesis
2. Origin: the visibility and control problem
3. Product shape: business OS for owner-operated retail and service businesses
4. What the system brings into one loop
5. The craft problem: operational trust
6. Where the deeper essays go
7. What remains incomplete

### Section Notes

#### Opening Thesis

Start with Athena as a system built around trust in daily operations.
Do not begin with the tech stack.

Possible thesis:

> Athena is my attempt to build software around the real control loop of a small business: what happened, what needs attention, who can act, and what evidence the owner can trust.

#### Origin

Name Wigclub here, but keep it brief.

Required framing:

Athena began with a concrete operating problem inside Wigclub: the owner needed clearer visibility and stronger controls across the daily work of the business.
Wigclub is the pilot context and proof environment.
The product ambition is broader: owner-operated retail and service businesses with similar pain points.

Avoid:

- Turning the essay into Wigclub's business story.
- Naming M Supplies.
- Making the product sound custom-only.

#### Product Shape

Explain Athena's surfaces:

- POS
- Storefront checkout
- Inventory
- Procurement
- Cash controls
- Daily close
- Staff work
- Services
- Analytics
- Operational evidence

The list should be tied to the control-loop thesis, not presented as feature sprawl.

#### Craft Problem

Core idea:
Trustworthy business operations require more than screens.
They require evidence, continuity, authority boundaries, observability, and production discipline.

### Proof Inventory

Use only public-safe proof in final copy.

Candidate proof:

- Production deployment and rollback.
- Owner/operator app plus customer storefront.
- Local-first POS and offline-aware workflows.
- Daily close and cash controls.
- Procurement and stock pressure.
- Observability and synthetic checks.
- Agent-ready harness and validation loops.

### Links Out

- The Store Cannot Stop Selling
- Treating Production As Part Of The Product
- Making The Codebase Legible To Humans And Agents

## Athena Sub-Essay: `/work/athena/local-first-pos`

### Working Title

The Store Cannot Stop Selling

### Page Job

Show how Athena's POS embodies operational trust under unreliable conditions.

### Reader Promise

The reader should understand why offline-aware POS is a product requirement, not just an implementation detail.

### Section Outline

1. The operating constraint
2. Why online-only systems fail the operator
3. Local-first register actions
4. Sync, reconciliation, and terminal recovery
5. What this taught me about product reliability

### Proof Points

- App shell and offline readiness.
- Register actions preserved before sync.
- Local events, mappings, conflicts, and terminal sync evidence.
- Terminal recovery and review summaries.

### Avoid

- Deep protocol details before the user problem is clear.
- Presenting offline support as a novelty instead of a trust requirement.

## Athena Sub-Essay: `/work/athena/production-system`

### Working Title

Treating Production As Part Of The Product

### Page Job

Show production ownership: deployment, rollback, monitoring, QA, and synthetic checks.

### Reader Promise

The reader should see that Athena is operated as a real system, not just built as an app.

### Section Outline

1. Why production work belongs in the product story
2. Deployment topology
3. Rollback and versioned releases
4. Observability and synthetic journeys
5. QA and production confidence
6. What production changed about the product

### Proof Points

- Cloudflare Tunnel and nginx routing.
- Convex backend.
- Valkey proxy.
- Versioned static deploys and rollback.
- QA deploy workflow.
- Checkly browser checks and Cloudflare health checks.
- Slack incident alerting.

### Avoid

- Turning the essay into a runbook.
- Overloading the reader with infrastructure names without explaining why they matter.

## Athena Sub-Essay: `/work/athena/agent-ready-repository`

### Working Title

Making The Codebase Legible To Humans And Agents

### Page Job

Show the delivery system behind Athena and connect agent readiness to maintainability.

### Reader Promise

The reader should understand that the repo harness is not process decoration; it is infrastructure for safer human and AI-assisted engineering.

### Section Outline

1. The problem: AI can only help where the system is legible
2. Generated maps and repo navigation
3. Validation, review, and fail-closed loops
4. Runtime behavior evidence
5. How this changes the way features are built
6. Why this still serves humans first

### Proof Points

- Generated route/test/folder/validation indexes.
- Graphify artifacts.
- Harness review and inferential review.
- Behavior scenarios and optional video evidence.
- Pre-push proof recording and scorecards.
- Fail-closed generated artifact repair.

### Avoid

- Making the page sound like AI hype.
- Treating agents as the audience instead of humans and agents together.

## Eventbrite Essay System

### Shared Structure

Each Eventbrite essay should use the same basic rhythm:

1. Situation
2. Problem beneath the ticket
3. My role
4. Key decisions
5. What changed
6. What I learned
7. What I would think about differently now

The essays should not expose confidential details.
Metrics and project names should be included only after public-safety review.

## Eventbrite Essay: `/work/eventbrite/dashy`

### Working Frame

Turning an analytics surface into an active guidance product required more than embedding an AI chat box.

### Page Job

Show full-stack product ownership across AI product design, backend contracts, frontend experience, telemetry, feedback capture, and experiment readiness.

### Section Outline

1. The dashboard had information; the next step was guidance.
2. Why the assistant needed a lifecycle model.
3. Designing contracts, guardrails, and feedback loops.
4. Building the user experience into the dashboard.
5. Making it measurable and experiment-ready.
6. What productionizing AI taught me.

### Proof Points

- AI-powered Event Dashboard Assistant.
- Lifecycle stage model.
- Chat, CSAT, and conversation BFF routes.
- Telemetry pipeline.
- Suggested prompts and system prompt guardrails.
- Sheet-based assistant UI.
- Heap instrumentation and A/B experiment tracking.

### Signal Chips

- AI product systems
- BFF contracts
- Telemetry
- Feedback loops
- Experiment readiness
- Dashboard UX

## Eventbrite Essay: `/work/eventbrite/event-dashboard`

### Working Frame

Modernizing a core dashboard surface without breaking user trust.

### Page Job

Show migration judgment, production stability, observability, permissions, rollout safety, and UX parity.

### Section Outline

1. Why dashboard migrations are trust problems.
2. Permissions and routing before polish.
3. Observability and analytics parity.
4. Matching the details users already depended on.
5. Rollout controls and rollback thinking.
6. What I learned about modernizing active surfaces.

### Proof Points

- Modern Event Dashboard migration to Valkyrie.
- Permission checks.
- Oops/404 experience.
- Recommended actions and timed-entry parity.
- Heap parity and missing-event investigation.
- CloudWatch RUM.
- Split.io rollout flag and rollback docs.
- Slow-load and unauthorized-state fixes.

### Signal Chips

- Dashboard migration
- Permissions
- Analytics parity
- Observability
- Feature flags
- UX parity

## Eventbrite Essay: `/work/eventbrite/payments-fraud-billing`

### Working Frame

Building user trust where correctness has financial consequences.

### Page Job

Show depth in payments, billing infrastructure, fraud prevention, Stripe correctness, testing, and regulated-market support.

### Section Outline

1. Payments work is trust work.
2. Learning the billing domain across unfamiliar stacks.
3. Correctness in Stripe-backed flows.
4. Fraud prevention and risk controls.
5. Testing as financial safety.
6. What this changed about my engineering bar.

### Proof Points

- Stripe/TLZ infrastructure.
- Terraform, API Gateway, DynamoDB, Lambda, WAF, CloudWatch.
- 3D Secure payment flows.
- Stripe Radar fraud prevention.
- Payment intent eligibility fixes.
- Invoice and customer services.
- Test coverage increases.
- Fraudulent payment reduction signal, pending public-safety review.

### Signal Chips

- Payments
- Stripe
- Fraud prevention
- Infrastructure
- Test coverage
- Financial correctness

## Eventbrite Essay: `/work/eventbrite/npo-automation`

### Working Frame

Using engineering to close the gap between policy intent and actual customer benefit.

### Page Job

Show product judgment: noticing a manual gap, creating alignment, designing automation, and improving outcomes for eligible organizations.

### Section Outline

1. The policy existed, but the benefit did not reliably reach users.
2. Finding the operational gap.
3. Scoping an automation path.
4. Designing for fairness, support load, and rollout safety.
5. What changed for eligible organizations.
6. What this taught me about product-minded engineering.

### Proof Points

- NPO monthly pro plan enrollment automation.
- ADR for NPO discount application.
- Design doc and rollout plan.
- Affected creators and communication planning.
- Approximately 3,200 organizations signal, pending public-safety review.

### Signal Chips

- Product judgment
- Automation
- Policy to product
- Support burden
- Fairness
- Rollout planning

## Note: `/notes/how-ai-changes-engineering-workflows`

### Working Title

How AI Changes Engineering Workflows When The Codebase Is Ready

### Page Job

Explain Kwamina's point of view on AI-assisted engineering without making the site AI-only.

### Reader Promise

The reader should understand that Kwamina sees AI engineering leverage as a systems problem: codebases need to become more legible, testable, observable, and reviewable.

### Section Outline

1. The shallow version: prompt in, patch out.
2. The deeper shift: engineering as feedback-loop design.
3. What the codebase has to provide.
4. What Athena changed about my workflow.
5. What Eventbrite reinforced.
6. What I believe now.

### Core Argument

AI does not only make coding faster.
It raises the value of codebases that can explain themselves, constrain work, validate changes, and preserve evidence.

### Proof Points

- Athena harness.
- Generated indexes.
- Graphify.
- Behavior scenarios.
- Proof recording.
- Fail-closed validation.
- Dashy and agentic feature-development workflows.

### Avoid

- Treating AI as magic.
- Centering tool names over workflow changes.
- Claiming AI replaces engineering judgment.

## Cross-Linking Plan

Homepage should link to:

- Athena main essay.
- Three Athena sub-essays.
- Four Eventbrite essays.
- AI workflow note.
- Resume/contact links.

Athena main essay should link to:

- Local-first POS.
- Production system.
- Agent-ready repo.
- AI workflow note.

Agent-ready repo essay should link to:

- AI workflow note.

AI workflow note should link to:

- Athena agent-ready repo.
- Dashy essay.

Eventbrite essays should link back to:

- Homepage Eventbrite section.
- How I Work principles when implemented.

## Public-Safety Review Queue

Before final copy ships, review:

- Eventbrite metrics.
- Eventbrite project names and internal system names.
- Eventbrite Jira/PR references.
- Athena screenshots with customer, order, email, amount, or business-sensitive data.
- Athena metrics from screenshots.
- Any production hostname or operational detail that should remain private.

## Drafting Order

1. Homepage.
2. Athena main essay.
3. Athena local-first POS.
4. Athena production system.
5. Athena agent-ready repo.
6. AI workflow note.
7. Eventbrite Dashy.
8. Eventbrite Event Dashboard.
9. Eventbrite payments/fraud/billing.
10. Eventbrite NPO automation.

Rationale:
The homepage sets the voice.
Athena establishes the flagship narrative.
The AI workflow note can reuse the agent-ready repo thinking.
Eventbrite essays then slot into a stable proof system.
