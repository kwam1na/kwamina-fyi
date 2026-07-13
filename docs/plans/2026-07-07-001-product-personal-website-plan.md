---
title: Personal Website - Plan
date: 2026-07-07
type: product
topic: personal-website
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Personal Website - Plan

## Goal Capsule

- **Objective:** Build a personal website that communicates Kwamina's software engineering craft, journey, proof of work, and current direction through a hiring-oriented narrative.
- **Product authority:** The approved structure from the July 7, 2026 brainstorm is the source of truth until superseded by a later content or design plan.
- **Open blockers:** Final copy outside the locked Athena framing, resume/contact links, a purpose-built public-safe Athena visual, and final visual design remain unresolved.

---

## Product Contract

### Summary

The website should read as a craft-centered, hiring-oriented personal site.
It should lead with Kwamina's engineering thesis, make Athena the flagship proof of craft, use Eventbrite work as professional evidence, and support the story with principles, formation, notes, and contact paths.

The core throughline is: **I build systems that turn messy operational reality into trustworthy software loops.**

### Problem Frame

The site should avoid feeling like a generic portfolio or a prettier resume.
It should communicate judgment, taste, ownership, production readiness, and love for the craft without over-indexing on personal biography.

The strongest story is not "here are projects I worked on."
It is "here is how I think about software, proven through a production personal system and through professional work in larger organizational contexts."

### Key Decisions

- **Craft-centered narrative:** The site centers Kwamina's engineering craft rather than personal biography, company chronology, or a project gallery.
- **Generalized hiring audience:** The site should work for a broad hiring audience instead of optimizing for startups, big tech, AI roles, or any single employer type.
- **Single-page narrative with anchored sections:** The homepage should be the main story, with anchors for scanning and links to deeper essays.
- **Hybrid depth model:** The homepage gives narrative previews; deeper pages carry reflective engineering essays.
- **Athena first:** Athena leads the proof section because it is the clearest expression of Kwamina's current craft, ownership, and pride.
- **Current work framing:** The homepage labels Athena as "Current work" and leads with "A business operating system for owner-led retail."
- **AI as engineering method:** The introduction states that Kwamina is using AI agents to build Athena; the site must not imply that Athena's customer promise is autonomous or AI-led.
- **Eventbrite as professional proof:** Eventbrite work follows Athena and shows the same judgment operating inside larger product, organizational, and production constraints.
- **Reflective essays over formal case studies:** Deep pages should read as authored engineering reflections, not sterile portfolio case studies.
- **Wigclub disclosure:** The homepage should not call out Wigclub; the Athena main essay can name Wigclub as the pilot context that surfaced the owner visibility and control problem.

### Actors

- **Hiring reader:** The primary reader. Needs fast credibility, clear proof, and enough depth to understand engineering judgment.
- **Technical peer or collaborator:** A secondary reader. Needs enough specificity to trust the craft claims.
- **Kwamina:** The site owner and narrative subject. Needs the site to feel authored, honest, current, and not overly biographical.

### Information Architecture

- `/`
- `/work/athena`
- `/work/athena/local-first-pos`
- `/work/athena/production-system`
- `/work/athena/agent-ready-repository`
- `/work/eventbrite/dashy`
- `/work/eventbrite/event-dashboard`
- `/work/eventbrite/payments-fraud-billing`
- `/work/eventbrite/npo-automation`
- `/notes/how-ai-changes-engineering-workflows`

### Homepage Flow

1. **Hero / Thesis**
   - Hybrid opening: a scene-like hook followed by a direct craft thesis.
   - The hero should establish that Kwamina builds software systems that hold up where users depend on them.
   - Primary actions should include reading the work, viewing the resume, and contacting Kwamina.

2. **Introduction**
   - Establish Kwamina as a product-minded builder.
   - State that Kwamina is using AI agents to build Athena, distinguishing the engineering method from Athena's customer-facing product promise.

3. **Current Work / Athena**
   - Use the kicker "Current work" and headline "A business operating system for owner-led retail."
   - Position Athena as the flagship expression of Kwamina's current product and engineering craft.
   - Explain Athena through three proof chapters: one connected operating record, continuity under real operating conditions, and a codebase engineered for humans and AI agents.
   - The homepage should not name Wigclub.
   - Link once to the dedicated Athena space.

4. **Work at Eventbrite**
   - Professional proof section.
   - Present four short narrative previews in strength-of-signal order.
   - Each preview links to a reflective engineering essay.

5. **How I Work**
   - Convert the proof into principles.
   - Each principle should be grounded in Athena or Eventbrite so the section does not read as abstract values copy.

6. **Formation**
   - Compact education and career context.
   - This section should build credibility without becoming memoir.

7. **Notes / Learnings**
   - Feature the first note: "How AI Changes Engineering Workflows When The Codebase Is Ready."
   - Keep the section modest in v1.

8. **Contact / Resume**
   - Make next steps obvious.
   - Include resume, email, GitHub, LinkedIn, and a concise current-focus line.

### Requirements

**Narrative Positioning**

- R1. The homepage must lead with a craft thesis rather than a biography, resume chronology, or visual gallery.
- R2. The site must be personal in voice without making personal background the organizing principle.
- R3. The site must communicate to a generalized hiring audience without tailoring the whole story to one company type or role category.
- R4. The core throughline must connect Athena and Eventbrite around trustworthy software loops.

**Homepage**

- R5. The homepage must function as a complete narrative for a 2-4 minute hiring read.
- R6. The homepage must use Athena as the first major proof section after the introduction.
- R7. The homepage must summarize Eventbrite work after Athena, not before it.
- R8. The homepage must use short narrative previews rather than metric-only cards.
- R9. The homepage must provide clear paths to deeper essays for readers who want evidence.

**Athena**

- R10. The homepage must frame Athena as "A business operating system for owner-led retail" under the "Current work" label.
- R11. The homepage must not name Wigclub.
- R12. The Athena main essay may name Wigclub as the pilot context and origin of the owner visibility/control pain point.
- R13. The Athena story must present Wigclub as a proving context, not as the ceiling of the product ambition.
- R14. The Athena homepage story must show a connected operating record, local-first continuity, and engineering systems that help humans and AI agents contribute safely.
- R15. The Athena section must link to one dedicated Athena space that carries the origin story, product model, technical decisions, current limitations, and deeper essays.

**Eventbrite**

- R16. The Eventbrite work section must present projects in strength-of-signal order: Dashy, Event Dashboard migration, payments/fraud/billing reliability, and NPO automation.
- R17. Each Eventbrite deep page must be a reflective engineering essay.
- R18. Eventbrite essays must show professional judgment, ownership, tradeoffs, outcomes, and learnings.
- R19. Eventbrite work must be presented as proof that the same craft principles operate inside larger organizational systems.

**Notes**

- R20. V1 must include a note titled or substantially framed as "How AI Changes Engineering Workflows When The Codebase Is Ready."
- R21. The AI workflow note must argue that AI's deeper leverage depends on codebase legibility, tests, documentation, observability, reviewable evidence, and recovery loops.
- R22. The AI workflow note must connect to Athena's agent-ready repo and Eventbrite's Dashy or agentic feature-development work.

### Athena Content Model

#### Main Essay: `/work/athena`

Working title: **Athena: Building Software Around Operational Trust**

Purpose:
Explain what Athena is, why it exists, what pain it addresses, what it is trying to prove, and what engineering philosophy it expresses.

Required beats:
- Athena is a business operating system for owner-led retail.
- Athena began from a concrete operating problem inside Wigclub: the owner needed clearer visibility and stronger controls across the daily work of the business.
- Wigclub is the pilot context and proof environment, not the limit of the product.
- The broader product goal is to serve businesses with similar pain points.
- The system brings POS, storefront checkout, inventory, procurement, cash controls, daily close, staff work, services, analytics, and operational evidence into one loop.
- The engineering lesson is that trustworthy operations require more than screens; they require evidence, continuity, authority boundaries, and production discipline.
- Kwamina is using AI agents to build Athena through a codebase designed for legibility, validation, review, runtime evidence, and recovery.
- AI describes the engineering workflow; Athena's public product promise remains owner visibility, connected operations, and evidence-supported decisions.

#### Sub-Essay: `/work/athena/local-first-pos`

Working title: **The Store Cannot Stop Selling**

Purpose:
Show how local-first POS expresses Athena's operational-trust philosophy.

Required beats:
- The POS must continue through unreliable networks and operational messiness.
- Register actions should preserve evidence before sync and reconciliation.
- Offline continuity, terminal recovery, and conflict handling are product concerns, not just technical details.

#### Sub-Essay: `/work/athena/production-system`

Working title: **Treating Production As Part Of The Product**

Purpose:
Show that Athena is productionized and that deployment, rollback, monitoring, and synthetic checks are part of the product surface.

Required beats:
- Production deployment and rollback are first-class concerns.
- Observability and synthetic journeys protect customer and operator trust.
- QA and production environments support safe iteration.

#### Sub-Essay: `/work/athena/agent-ready-repository`

Working title: **Making The Codebase Legible To Humans And Agents**

Purpose:
Show the engineering-process craft behind Athena.

Required beats:
- The repo harness makes the codebase easier to navigate, validate, and review.
- Generated docs, graph artifacts, validation maps, behavior scenarios, proof recording, and fail-closed checks are part of the system's delivery discipline.
- The essay should connect agent readiness to human maintainability, not treat it as an AI gimmick.

### Eventbrite Content Model

#### `/work/eventbrite/dashy`

Working frame:
Turning an analytics surface into an active guidance product required more than embedding an AI chat box.

Required beats:
- AI-powered Event Dashboard Assistant.
- Lifecycle model, BFF contracts, telemetry, feedback capture, and production-ready UI integration.
- The work should show product ambiguity, AI system design, frontend craft, analytics, and operational discipline.

#### `/work/eventbrite/event-dashboard`

Working frame:
Modernizing a core dashboard surface without breaking user trust.

Required beats:
- Migration to the modern Event Dashboard/Valkyrie surface.
- Permissions, routing, analytics parity, observability, feature-flag rollout, UX parity, and stability work.
- The work should show migration judgment and production ownership.

#### `/work/eventbrite/payments-fraud-billing`

Working frame:
Building user trust where correctness has financial consequences.

Required beats:
- Stripe/TLZ infrastructure, billing services, 3DS, fraud prevention, payment correctness, and test coverage.
- Include the fraud reduction and coverage signals when final copy verifies which numbers are public-safe.
- The work should show infrastructure fluency and financial-domain care.

#### `/work/eventbrite/npo-automation`

Working frame:
Using engineering to close the gap between policy intent and actual customer benefit.

Required beats:
- NPO plan enrollment automation.
- The story should show product judgment, stakeholder alignment, manual-process reduction, fairness, and support burden reduction.
- Include the approximately 3,200 organization signal when final copy verifies that it is public-safe.

### How I Work Principles

- **Build around operational trust:** Design for what users need to know, prove, recover, and rely on.
- **Make systems observable:** Treat instrumentation, analytics, monitoring, and feedback loops as part of the craft.
- **Treat rollout and rollback as product work:** Safe delivery is part of the user experience.
- **Automate through evidence and authority boundaries:** Automation should act from trusted records and preserve accountability.
- **Learn domains deeply enough to improve them:** Good engineering judgment comes from understanding the work behind the interface.

### Notes Content Model

#### `/notes/how-ai-changes-engineering-workflows`

Working title: **How AI Changes Engineering Workflows When The Codebase Is Ready**

Core thesis:
AI does not only make individual coding tasks faster.
Its deeper leverage appears when the engineering system is legible enough for agents to understand intent, inspect context, run checks, produce evidence, and recover from mistakes.

Required beats:
- The shallow version of AI coding is prompt-in, patch-out.
- The deeper workflow shift is toward better feedback loops.
- Codebases need structure, documentation, tests, observability, validation commands, and bounded work surfaces.
- Athena's harness, generated indexes, graphify, behavior scenarios, proof recording, and fail-closed validation are concrete examples.
- Eventbrite's Dashy or agentic feature-development work can show how this thinking appeared in professional contexts.
- The note should end with the belief that AI rewards engineers who make systems understandable.

### Sources And Inputs

- User conversation on July 7, 2026.
- User-provided Eventbrite contribution, resume, and role/accomplishment PDFs.
- Athena repository context inspected from the local Athena repo.
- Athena product, deployment, observability, harness, and generated proof-point materials inspected during the brainstorm.
- Athena positioning, product-proof, landing-page, local-first POS, and agent-readiness materials reviewed on July 12, 2026.

### Scope Boundaries

- **Deferred for design phase:** visual language, typography, color palette, component styling, motion, responsive layout details, and a purpose-built sanitized Athena product visual.
- **Not approved for publication:** Existing Athena screenshots containing organization, account, customer, product, or operational details.
- **Deferred for content drafting:** final prose, exact metrics, public-safe proof details, resume copy, and contact links.
- **Deferred for implementation planning:** framework choice, content architecture mechanics, file layout, deployment target, and testing strategy.
- **Outside v1:** full blog system beyond the first AI workflow note, exhaustive project archive, and a biography-first about page.

### Success Criteria

- A hiring reader can understand Kwamina's engineering identity from the homepage alone.
- Athena reads as a real production system and flagship expression of craft.
- Eventbrite work reads as professional proof, not as a disconnected resume section.
- The site feels authored and reflective without becoming overly personal.
- The first note adds current AI workflow signal without turning the whole site into AI-only branding.

### Outstanding Questions

**Resolve Before Content Drafting**

- Which Eventbrite metrics and project names are public-safe to publish?

**Deferred to Design**

- What sanitized Athena product composition should support the text-led homepage section and dedicated page?
- What resume, email, GitHub, and LinkedIn links should be used?
- What education and early career details should appear in the compact Formation section?

**Resolve During Content Drafting**

- What exact hero hook and thesis line should the homepage use?
- How much of Wigclub's origin context should the Athena main essay include?
- Which Athena proof points should be quantified versus described qualitatively?
- Should the AI workflow note lean more on Athena, Eventbrite, or a balanced comparison?
