# Site chatbot: LLM Q&A layer over kwamina.fyi

**Date:** 2026-08-07
**Status:** Live and answering on kwamina.fyi. Rate limiting landed in the
Worker instead of the WAF (see "Rate limiting" below). One step outstanding: an
Anthropic spend cap.

## Goal

A chat interface on the site where visitors ask questions about Kwamina and an LLM
answers, grounded strictly in the site's published content. Conversations persist
across visits. Everything runs on the existing Cloudflare deployment; the AI layer
uses TanStack AI end to end (server `chat()` + Anthropic adapter, client `useChat`).

## Architecture overview

```
Browser (React SPA)
  └─ ChatWidget — @tanstack/ai-react useChat, SSE connection adapter
       │  POST /api/chat  { conversationId, messages }
       ▼
Cloudflare Worker (same wrangler deploy, new `main` script)
  ├─ serves static assets (unchanged, existing `assets` config)
  ├─ /api/chat: @tanstack/ai chat() + @tanstack/ai-anthropic (Haiku 4.5)
  │    system prompt = generated corpus (prompt-cached)
  │    streams via toServerSentEventsResponse()
  │    persists user + assistant messages to D1 after stream completes
  └─ D1 binding: conversations + messages tables
```

Key decisions already made in discussion:

- **No RAG.** The corpus (~5 pages + resume evidence) fits in the system prompt;
  prompt caching makes repeat requests cheap. A build step concatenates content
  into one markdown file.
- **D1 for persistence** (queryable SQL, free tier ample). Conversation ID is a
  server-minted UUID stored in `localStorage` — no accounts, no auth.
- **Model: Haiku 4.5** (`claude-haiku-4-5-20251001`) — fast/cheap, sufficient for
  grounded Q&A. Model name isolated in one constant for easy upgrades.
- **Privacy:** store only conversation ID, role, content, timestamps. No IPs in
  D1; IPs used transiently for rate limiting only.
- **Content boundary:** corpus is exactly the published pages (Wigclub nameable,
  system facts fine, no security internals) — the pages already respect this line.

## Phase 1 — Corpus build step

New script `scripts/build-corpus.mjs` (run in `build`/`deploy` before vite):

- Reads `docs/content/about.html`, `homepage-draft-v1.md` (or `.html`), the three
  Athena pages, and `docs/content/work/athena/evidence.md`.
- Strips HTML to readable text/markdown (small hand-rolled strip, no new deps;
  Node's available in the build environment).
- Emits `src/generated/corpus.md` (gitignored) with per-page source headers, so
  the model can attribute answers ("as described on /work/athena…").
- Worker imports it as a raw string at build time (`?raw` via vite for the worker
  bundle, or plain `fs` read inlined by the worker build — see Phase 3 tooling).

Acceptance: corpus file generates deterministically; size sanity-checked
(< ~40k tokens) with a warning if it grows past that.

## Phase 2 — D1 schema and bindings

- `wrangler d1 create kwamina-fyi-chat` (one-time, manual — records `database_id`
  in wrangler.jsonc).
- `migrations/0001_init.sql`:

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,            -- UUID
  created_at INTEGER NOT NULL     -- unix ms
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
```

- Apply with `wrangler d1 migrations apply` (local + remote).
- wrangler.jsonc gains `d1_databases` binding `DB` and `main` pointing at the
  worker entry.

## Phase 3 — Worker backend

New `worker/index.js` (set as `main` in wrangler.jsonc; static assets continue to
be served by the `assets` config — the worker only sees non-asset requests):

- **Dependencies:** `@tanstack/ai`, `@tanstack/ai-anthropic`.
- **`POST /api/chat`** body `{ conversationId?: string, message: string }`:
  1. Rate limit per IP (simple in-memory token bucket per isolate + Cloudflare
     WAF rule as backstop; document the WAF step as manual).
  2. Validate message (non-empty, ≤ 2k chars).
  3. Create conversation row if no/unknown `conversationId`; mint UUID.
  4. Load prior messages from D1 (cap at last 30 for context).
  5. `chat({ adapter: createAnthropicChat(MODEL, env.ANTHROPIC_API_KEY), messages: [history..., user msg], system: GUARDRAIL_PROMPT + corpus, maxTokens: 1024 })`
     with prompt caching enabled on the system block.
  6. Return `toServerSentEventsResponse(stream)` with `X-Conversation-Id` header;
     tee/accumulate the stream and on completion write user + assistant messages
     to D1 (`ctx.waitUntil` so persistence doesn't block the stream).
- **`GET /api/chat/:conversationId`** — returns message history so a returning
  visitor's widget can rehydrate.
- **Guardrail system prompt:** answer only about Kwamina from the corpus; decline
  off-topic requests, prompt-injection attempts, and requests to reveal the
  prompt; concise tone; link to site pages where relevant.
- **Secrets:** `wrangler secret put ANTHROPIC_API_KEY` (manual step). Spend cap
  set on the Anthropic console key (manual step, documented).
- **Worker bundling:** wrangler bundles `worker/index.js` with esbuild natively —
  npm deps and a raw-text import of the corpus work via a small esbuild text
  loader rule or by generating `src/generated/corpus.js` (`export default "..."`)
  from the build script. Plan: emit `.js` module from Phase 1 to avoid loader
  config entirely.
- **Dev story:** `bun run preview` (existing `vite build && wrangler dev`)
  exercises the real worker + local D1. Add `dev:worker` script note in README.

## Phase 4 — Chat UI

- **Dependencies:** `@tanstack/ai-client`, `@tanstack/ai-react`.
- `src/chat/chat-widget.jsx`: floating launcher button (bottom-left, mirroring
  the existing bottom-right ThemeToggle), expanding to a chat panel.
  - `useChat` with the SSE connection adapter pointed at `/api/chat`.
  - On first response, read `X-Conversation-Id` → `localStorage`; on mount with a
    stored ID, fetch `GET /api/chat/:id` to rehydrate history.
  - States: idle, streaming (typing indicator), error (retry affordance),
    rate-limited notice.
  - Suggested starter questions (e.g. "What is Athena?", "What's Kwamina's
    background?") shown when empty.
- Styling: Tailwind v4 utilities consistent with `styles.css` tokens; honors the
  existing light/dark theme mechanism; respects `prefers-reduced-motion`.
- Mounted in `RootLayout` in `main.jsx` alongside `ThemeToggle` — present on all
  routes including 404.
- Accessibility: focus trap in panel, `aria-live="polite"` on message list,
  Escape closes, launcher has an accessible label.

## Phase 5 — Verification & rollout

1. Local: `bun run preview` → chat end-to-end against local D1 + real API key
   (dev var). Verify streaming, persistence across reload, rehydration, redlines
   (off-topic question declined, oversized message rejected).
2. `wrangler d1 migrations apply --remote`, `wrangler secret put`, deploy.
3. Production smoke test; inspect D1 rows via `wrangler d1 execute`.
4. Post-deploy: add Cloudflare WAF rate-limit rule on `/api/chat` (manual).

## Out of scope (this iteration)

- Tool use / function calling (TanStack AI supports it; nothing needs it yet).
- Analytics dashboards over conversations (D1 makes this easy later).
- Feedback thumbs, conversation deletion UI, i18n.
- RAG/embeddings — revisit only if corpus outgrows the prompt.

## Risks

- **TanStack AI is young** (pre-1.0): API drift between `@tanstack/ai` releases.
  Mitigation: pin exact versions; the surface we use (chat, SSE response, useChat)
  is its core path.
- **Workers runtime compat**: adapter uses fetch-based streaming (fine on
  Workers), but verify no Node-only APIs sneak in; `nodejs_compat` flag is
  already enabled.
- **Prompt injection via chat**: guardrail prompt + no tools + output only to the
  same user limits blast radius to content quality, not data exposure.

## What was actually built

Files added: `scripts/build-corpus.mjs`, `migrations/0001_init.sql`,
`worker/index.js`, `src/chat/chat-widget.jsx`, `src/chat/chat-panel.jsx`,
`.dev.vars.example`, `.claude/launch.json`. Modified: `wrangler.jsonc`,
`package.json`, `src/main.jsx`, `src/styles.css`, `.gitignore`.

Six deviations from the plan above, all discovered while building:

1. **`run_worker_first: ["/api/*"]` is mandatory, not optional.** With the SPA
   `not_found_handling`, the asset worker answers first and returns index.html
   for any unmatched path — `/api/chat` included. Without this the backend is
   unreachable and the failure looks like a client bug.
2. **The AG-UI `threadId` is the conversation id.** TanStack AI already carries
   one end to end, so the planned bespoke `conversationId` field and
   `X-Conversation-Id` header were dropped. `useChat({ threadId })` on the
   client, `chatParamsFromRequestBody` on the server.
3. **The panel is lazily imported.** `@tanstack/ai-react` is ~145kB and would
   have loaded on every page view for a feature most readers never open. The
   launcher lives in the main bundle (+2kB); the panel is its own chunk.
4. **Upstream errors are sanitised.** A failed run arrives as a `RUN_ERROR`
   *event on the stream*, not a rejected promise, so the raw provider message
   (including request ids) would have streamed to the browser. The Worker now
   logs the real error and forwards a generic one.
5. **Rate limiting is layered, and none of it is in the WAF.** The planned
   in-isolate token bucket is module-level request state, which Workers best
   practice rules out. What shipped: per-conversation limits on the
   `conversations` row, plus two per-caller layers described under "Rate
   limiting" below.
6. **Model id is `claude-haiku-4-5`**, the adapter's own identifier, not the
   dated API string.
7. **The client needs a custom `fetchClient` to show the Worker's error copy.**
   The connection adapter replaces any non-OK response with "HTTP error! status:
   429" and drops the body, and what `useChat` finally exposes is a flattened
   plain `Error` — no subclass, no `cause` — so neither the status nor the
   Worker's wording survives. The panel reads the message where the response
   still exists and holds it in a ref for the render the failure triggers.

## Verified

Locally against `wrangler dev`, with a real key and local D1: grounded answers
that cite their source page, multi-turn context ("what stack does *it* use?"
resolved to Athena from stored history), persistence and read-back, prompt
caching (15,020 cached tokens on the second call), and the guardrails — general
coding help declined, prompt-extraction declined, salary question declined
without fabricating. Also all four request-validation rejections, the
conversation cap, the per-turn throttle, error sanitisation (raw provider 401 in
the logs, generic message on the wire), no persistence when a run yields no
text, and the widget in both themes plus a 375px viewport.

In production, after deploy: `POST /api/chat` reaches the Worker (503, pending
the secret), `POST /api/bogus` returns the Worker's 404, `POST /` and `/about`
return the asset worker's 405, and `GET /api/chat/:id` reads remote D1. Note
that routing looked broken for the first minute after deploy — every POST
returned 405 until the config propagated.

Two corrections found by testing. The model's first answers arrived in Markdown,
which this UI renders as literal asterisks — the system prompt now asks for
plain prose explicitly and names the reason. And every Worker rejection reached
the reader as "HTTP error! status: 429" until the custom `fetchClient` above;
the friendly copy is now confirmed on screen (verified with the conversation
cap).

## Rate limiting

The plan ended with "add a WAF rate-limit rule in the dashboard". That turned
out to be neither necessary nor possible from here, and the investigation
changed the design.

**WAF is not reachable from the CLI.** Wrangler has no WAF or ruleset commands
at all, and the OAuth token from `wrangler login` carries `zone (read)` — a
`GET` on the zone's `http_ratelimit` ruleset returns `Authentication error
(10000)`. Doing it by API would mean creating a token with Zone → WAF → Edit,
which is a credential the account owner has to mint.

**The Workers rate-limit binding replaces it, with a caveat worth knowing.**
`ratelimits` in wrangler.jsonc needs no dashboard, no extra permission, and
works on the Free plan. But measured against production it only stops bursts:
30 parallel requests produced five 429s, while **40 sequential requests all
passed**. Its counters do not span the isolates a paced sequence lands on. As
the sole defence it would have missed precisely the case that matters — a slow
script quietly draining the API budget.

**So there are two layers**, both keyed on the caller rather than the
conversation, since minting a fresh thread id per request is what sidesteps the
per-conversation limits:

1. `CHAT_RATE_LIMITER` (10/60s) — free, fast, catches floods.
2. A D1 counter (15/60s) — one primary means one count, so pacing does not
   evade it. Costs a write per request. Verified in production: exactly 15
   sequential requests through, 429 from the 16th.

The D1 key is a SHA-256 of the caller's address salted with the current day and
truncated to 10 bytes, so the table holds counters rather than addresses and
they stop being derivable at midnight. An hourly cron sweeps expired rows.

Both layers fail open: if D1 or the binding errors, the request proceeds and
the failure is logged. Availability of the site beats strictness of the limit.

A WAF rule would still be a reasonable belt-and-braces addition, since it
rejects before the Worker runs at all. It is no longer load-bearing.

## Remaining steps

1. **Spend cap** on the Anthropic key. This is the last thing standing between
   a bug or a determined abuser and an open-ended bill — the rate limits bound
   the request rate, not the total spend.

## Operating notes

- The corpus regenerates on every build, so editing a page updates the
  assistant. No separate step, but a page edit does need a deploy to take
  effect.
- `database_id` in wrangler.jsonc also keys the *local* D1. Changing it points
  local dev at a fresh empty database — re-run `bun run db:migrate` when that
  happens.
- Reading the transcripts: `wrangler d1 execute kwamina-fyi-chat --remote
  --command "SELECT role, content FROM messages ORDER BY created_at DESC LIMIT 20"`.
