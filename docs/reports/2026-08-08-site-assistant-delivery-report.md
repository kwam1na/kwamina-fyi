# Site assistant delivery report

**Delivery:** AI question-and-answer layer for kwamina.fyi  
**Candidate:** `feat/site-chatbot` against `origin/main` (`39a17fc`)  
**Prepared:** 2026-08-08, before merge and production deployment  
**Status at capture:** release candidate; local verification complete, production migration and deployment pending

## What the candidate includes

This delivery adds a site-wide, anonymous assistant that answers questions about Kwamina, Athena, and the work described on the published site. It is a real product layer rather than a decorative chat shell: a lazy-loaded React interface streams Anthropic responses through a Cloudflare Worker, reconstructs authoritative history from D1, understands the page a reader is referencing, and turns supported destinations into first-class links.

The work also adds the operational boundaries needed to run that assistant in public: a generated and versioned knowledge corpus, strict grounding instructions, request and output limits, two caller-level rate controls, durable transcript persistence, per-turn provenance, schema migrations, sanitized failure handling, and a migration-first deployment command.

The repo-local `.agents/` skill set and `skills-lock.json` are included in the candidate. They make the design and animation practices used here reproducible for future contributors; they are not part of the production bundle.

## The architecture in one view

```text
six published pages
      │ build-corpus.mjs
      ▼
versioned corpus + canonical route allowlist
      │
      ▼
React chat panel ── POST /api/chat ──► Cloudflare Worker ──► Claude Haiku 4.5
      ▲                                      │
      │                                      ├─ D1 transcript + provenance
      └── GET /api/chat/transcript ──────────┤
          x-chat-thread-id                   └─ caller rate controls
```

The complete public corpus is placed in one cacheable system prompt. That is intentionally simpler than retrieval for a roughly 12,500-token corpus. The build emits the corpus, a content hash, and the page allowlist together, so routing, page context, and assistant knowledge cannot silently drift into separate lists.

## Reader experience

The assistant is available from every route but its heavy dependencies load only after the launcher is opened. A returning browser resumes the UUID stored in local storage and replays the newest 30 messages from D1. Closing and reopening the panel therefore preserves the visible transcript; replay failure has explicit retry and new-chat recovery instead of silently presenting an empty conversation.

The panel title follows navigation—only the page name flips while “Ask about” remains still. Questions that explicitly say “this page” receive canonical page context. Ordinary questions remain site-wide, so asking about Kwamina from an Athena technical reflection still uses the full corpus.

Streaming text is buffered into a short Unicode-safe reveal rather than mirroring uneven provider chunks. It respects reduced motion and autoscrolls only when the reader is already near the bottom. The renderer supports limited bold text, canonical in-app links, and labeled email, LinkedIn, and GitHub links with the site’s arrow affordance; it does not expose raw destinations behind those labels.

## Trust boundaries

### Published knowledge only

The corpus contains six public pages. Internal evidence notes were deliberately removed: prompt instructions are not a confidentiality boundary. The assistant contract tells the model to keep facts inside their source documents, avoid inference about employment or availability, decline unrelated work, and link to canonical pages when a reader can go deeper.

### Server-authoritative history

The client supplies the current question and an anonymous thread credential, but D1 supplies prior model context. A stale or tampered browser transcript cannot rewrite the conversation. Each user turn stores the canonical page it referred to, so historical phrases such as “this page” continue to mean the page on which they were originally asked.

Only one model run may hold a thread at a time. Migrations `0005_turn_reservations.sql` and `0006_turn_ownership.sql` add an atomic D1 reservation, stale recovery, and an ownership token. A superseded slow stream can neither write through nor release its replacement. The Worker streams content immediately but withholds terminal success until the completed user and assistant turn is durable. Provider failures and interruptions release the reservation and never save partial output as a successful answer.

### Anonymous, bounded persistence

D1 stores the opaque thread identifier, message text, timestamps, canonical page context, environment/source classification, assistant version, corpus version, model, and latency. It does not store accounts, raw IP addresses, or user agents.

The transcript credential is carried in `x-chat-thread-id`, not the URL, to keep it out of ordinary path telemetry. Caller counters use a daily HMAC-SHA-256 value keyed by the `RATE_LIMIT_KEY` Worker secret; a D1 reader cannot enumerate ordinary IPv4 addresses from those keys. Evaluation traffic is recognized only by a server-held token, not a public forwarded property.

Requests are capped at 128,000 bytes, 2,000 question characters, and a bounded protocol history. Model context and replay select the newest 30 stored messages. Conversation lifetime itself is not capped.

## Failure and cost behavior

The endpoint combines Cloudflare’s rate-limit binding for bursts with a D1 counter for paced traffic that spans isolates. Both are caller-keyed, so minting a new conversation does not reset the budget. The Worker also enforces per-thread pacing and single-turn admission.

Provider error events are logged on the server and replaced with generic reader-safe copy. Persistence must complete before terminal success. Transcript responses are private and non-cacheable. Static assets remain assets-first, while `/api/*` is explicitly routed through the Worker so the SPA fallback cannot swallow API failures.

These controls limit request rate, not total Anthropic spend; the provider account remains the final spend-cap boundary.

## Schema and release mechanics

Six additive migrations build the storage layer:

1. conversations and ordered messages;
2. rotating caller rate counters;
3. per-user-message canonical page paths;
4. source, environment, assistant/corpus/model versions, latency, and an analysis index;
5. atomic active-turn reservations and stale recovery.
6. reservation ownership tokens that fence off superseded Worker instances.

`bun run deploy` now builds first, applies remote migrations, verifies migration state, and only then publishes the Worker and assets. The ordering matters because the new Worker reads and writes the additive columns immediately. If deployment fails after migration, the prior Worker remains compatible; rollback should target the Worker version, not reverse the schema.

The production build now gives React, TanStack Router, and Anime.js explicit Rolldown chunk groups. The largest emitted JavaScript chunk is 189.64 kB, so the previous Vite 500 kB advisory is resolved without raising the warning threshold.

## Verification evidence

The candidate passed the following before this report was written:

- `bun run test`: 58 Bun tests and 19 Python content tests, all passing;
- `bun run build`: successful, with no 500 kB chunk advisory;
- incremental migration: an existing pre-reservation conversation upgraded through `0005_turn_reservations.sql` and `0006_turn_ownership.sql` with safe `idle`/null defaults; the local migration ledger has no work remaining;
- clean-slate migration: all six migrations applied in order to a fresh persisted D1 instance;
- schema inspection: expected conversation reservation and message provenance columns present;
- `wrangler deploy --dry-run`: Worker and 32 static assets packaged successfully;
- `wrangler check startup`: Worker built and analyzed successfully, with a 24.4 ms local profile window;
- `git diff --check`: clean.

Production migration, deployment, and live smoke evidence are intentionally not claimed here because this is a pre-merge candidate artifact. They belong in the final release handoff after the candidate is merged.

## How the implementation evolved

The first implementation established the core architecture: whole-corpus grounding, TanStack AG-UI streaming, D1 transcripts, anonymous threads, and layered rate limiting. Product testing then exposed the boundaries that mattered in practice:

- page context originally overpowered site-wide questions, so context became opt-in and per-turn;
- raw route paths and Markdown flashed during streaming, so parsing became incremental and allowlisted;
- contact answers exposed destinations, so the renderer now presents concise labels;
- closing and reopening could show an empty local transcript, so D1 replay became explicit and recoverable;
- a model error could leak provider detail or preserve truncated text, so terminal events are sanitized and failed output is not persisted;
- simultaneous sends could read the same history, so D1 now reserves the conversation atomically;
- caller hashes were enumerable and transcript credentials appeared in URLs, so HMAC keying and header-based replay tightened the privacy boundary;
- the initial bundle crossed Vite’s advisory, so stable framework dependencies gained explicit caching boundaries.

This sequence is the central lesson of the delivery: conversational UI quality depends less on the happy-path model call than on authority, replay, streaming completion, and route semantics around it.

## Review evidence

Two independent evidence-gathering passes informed this report:

- `report_session_context` reconstructed prior implementation decisions and identified where the current dirty candidate had advanced beyond the original committed assistant.
- `report_diff_context` mapped the current delivery files, migrations, validation surface, and release risks.

Three release reviewers separately assessed correctness, security/data handling, and merge/deployment readiness. Their initial findings drove the atomic turn reservation, durable terminal gating, failed-stream behavior, HMAC caller keys, header-based transcript credential, public-only corpus, body cap, exact fixture prefixes, lockfile refresh, migration-safe deploy command, and clean-slate migration proof. The final release decision must use their post-fix re-review, not the earlier findings alone.

## What remains intentionally out of scope

- accounts or cross-device history;
- a conversation list, deletion, export, or feedback UI;
- embeddings or retrieval infrastructure;
- model tools or side effects;
- a transcript analytics dashboard;
- multilingual response policy;
- storing visitor identity.

## Comprehension check

Score one point per question. A passing score is **8/10**.

1. Why does the assistant use one complete corpus prompt instead of retrieval today?
2. What prevents a client from rewriting earlier model context?
3. When is current-page context attached to a question?
4. Why is terminal success held after the visible content stream?
5. Is partial assistant text persisted after a provider failure, and what happens to the reservation?
6. Why is the transcript credential sent in a header rather than the URL?
7. What makes the caller counter resistant to IPv4 enumeration from D1?
8. Which two controls jointly cover burst and paced request traffic?
9. Why do remote migrations run before the Worker deploy?
10. What change removed the Vite 500 kB advisory?

<details>
<summary>Answer key</summary>

1. The six-page public corpus is only about 12,500 tokens, so one cacheable prompt is simpler and currently within budget; retrieval should follow measured need.
2. The Worker reconstructs prior history from D1 and treats the client transcript only as display/input state.
3. Only when the question explicitly refers to its surroundings and the supplied pathname resolves through the generated canonical allowlist.
4. So a close/reopen or immediate follow-up after `RUN_FINISHED` cannot observe stale history; persistence is part of successful completion.
5. No. Text already streamed may remain visible in the current panel, but it is not stored as a successful assistant answer; the active-turn reservation is released.
6. To keep the possession-based credential out of normal request-path telemetry and logs.
7. A daily HMAC-SHA-256 keyed by the secret `RATE_LIMIT_KEY`, rather than an unsalted hash of the address.
8. The Cloudflare rate-limit binding catches bursts; the D1 caller counter catches paced traffic across isolates.
9. The new Worker immediately reads and writes new additive columns, while the old Worker remains compatible with them if deployment fails.
10. Explicit Rolldown groups split React, TanStack Router, and Anime.js into stable chunks instead of increasing the warning limit.

</details>
