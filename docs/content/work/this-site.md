# How this site is built

This document describes kwamina.fyi itself, including the assistant answering questions on it. There is no public page for this material.

kwamina.fyi is Kwamina's personal site: his writing, the Athena work, and his background. It is one of his projects alongside Athena, and the way it is built shows how he architects systems.

The assistant answering questions here is one feature of that site, not the site itself. The published pages are the site; the assistant is a layer over them that reads what they say and answers questions about them. Remove it and the pages still render, read, and deploy exactly as they do now. The engineering decisions below are decisions taken while building the site, not a description of what the site is.

## The site at a glance

- Frontend: React 19, TanStack Router, Vite, Tailwind CSS.
- Backend: one Cloudflare Worker serving both the static site and the chat API, with D1 as the conversation database.
- Toolchain: Bun, pinned, with every dependency resolved to an exact version.
- Verification: around 200 tests on every build, plus a production canary every six hours.
- Deploys: pushing to the main branch builds and deploys, with database migrations gated to that branch so preview builds never touch the production schema.
- Security headers: a content security policy generated at build time, so the hash covering the site's one inline script is recomputed from the built page rather than maintained by hand.
- The assistant, one feature among these: Claude, grounded in the published pages, with no vector store.

## The assistant: grounded by construction, not by retrieval

The assistant carries no vector database and performs no retrieval. At build time the published pages are flattened into a versioned corpus and shipped inside the model's instructions, cached so the cost is paid once rather than per message. The result: the assistant cannot claim anything a visitor cannot read on the site, and editing a page updates the assistant in the same deploy.

Retrieval was considered and deferred. The corpus is measured against an explicit token budget, and the build warns when it approaches the line where retrieval would earn its complexity. Until then, the simpler architecture is the more correct one.

The same restraint governs the answers. The assistant's instructions keep each claim inside its source boundary: a technology used at one job is never transferred onto another, and a metric is never rounded or reattributed.

## Durability: the chat stream never signals success before the record exists

Responses stream token by token, so the reader sees words immediately. The finished signal is withheld until the turn is committed to the database: latency stays low where the reader can feel it, and the one signal that implies durability is never sent ahead of the durable write.

The stored conversation, not the browser's copy, is what the model reads on the next turn. A tampered client payload cannot rewrite the history the model reasons over. The same lesson as Athena's register, at chat scale: record the work before reporting success.

## Observability: measured by allowlist, failing open by design

Observability starts from a written allowlist of what may leave the browser; everything else is refused at a single sanitization boundary shared by the page, the worker, and analytics. Routes off the site's own map are reported as unrecognized rather than echoed. Error reports carry fixed outcome codes instead of raw messages. Do Not Track is honored, and analytics keep only a coarse device class: deliberately too little to fingerprint anyone.

The layer is built to lose. Analytics delivery is queued, bounded, and dropped on the first sign of trouble, because measurement must never affect what the reader came for. Deeper tracing stays off until its exported envelopes pass the same privacy review. Ready in the repository is not the same as earned in production.

## Verification: the content is tested like code

Around 200 tests run on every build: the worker's chat pipeline end to end, the stream finalizer, rate limiting, the chat interface, the observability contract, and the production smoke client. The canary that checks production every six hours has tests of its own, and a documented cost ceiling.

Each page is authored as a complete HTML document that renders as the page, feeds the assistant's corpus, and passes its own suite: internal links must resolve, headings must not skip levels, figures must carry structured text equivalents, and each article's published read-time estimate fails the build when the word count drifts from it.

## Design engineering: motion as annotation, never as obstacle

On the homepage, reaching toward the headline's operative word inks a rule beneath it while the rest of the line recedes, driven by pointer proximity and opted into declaratively from the markup. Every effect is capability-gated and reversible: proximity binds only where a fine pointer exists, reduced-motion preferences are respected everywhere, and every reveal leaves the text fully legible when it declines to run.

The geometry is pure functions, unit-tested apart from the DOM that applies them. Per-frame style writes were measured, found to repaint the page, and coalesced into a single animation frame.

## Candid limits

- The corpus approach is sized for this site. Whole-corpus grounding works because the site is small; a larger body of content would cross the budget where retrieval earns its place.
- Grounding bounds the sources, not the sentences. A small model can still phrase a documented fact imperfectly. Instructions and evaluation runs reduce that; they do not abolish it.
- Coarse analytics leave questions unanswered. Refusing identifiers and raw URLs means some product questions cannot be asked of the data. That trade is accepted, not solved.
- The discipline is proportionate, not exhaustive. This is a personal site with a focused test suite and a scheduled canary, not a claim to enterprise operational rigor.
