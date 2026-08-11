# kwamina.fyi

Personal site for Kwamina: a small set of authored content pages, plus an AI
assistant that answers questions about them. A React SPA and a Cloudflare
Worker ship as one deployment — static assets first, `/api/*` handled by the
Worker.

## Architecture

```text
docs/content/*.html, *.md          authored pages + assistant-only notes
        |
        | scripts/build-corpus.mjs  (runs before every dev/build/test)
        v
src/generated/corpus.js            flattened text + version + page allowlist
        |
        +--> Vite build --> dist/  static SPA (React 19, TanStack Router)
        |
        +--> worker/index.js       imported into the Worker bundle
                 |
   browser chat --POST /api/chat--> Worker --stream--> Anthropic (Haiku 4.5)
                 |                    |
                 |                    +--> D1: authoritative transcript history
                 |                    +--> layered per-caller rate limits
                 |                    +--> structured Workers logs
                 |
                 +--GET /api/chat/transcript (x-chat-thread-id)
```

The whole corpus rides in the system prompt — there is no retrieval index.
Prompt caching means it is paid for once per five minutes rather than per
message. The assistant has no tools, fetches nothing, and must say so when the
corpus does not establish a fact.

Full design and operations detail: [docs/site-assistant.md](docs/site-assistant.md)
and [docs/observability.md](docs/observability.md).

## Layout

| Path | What lives there |
| --- | --- |
| `docs/content/` | Authored page content (the source of truth for the site and the corpus) |
| `docs/plans/`, `docs/reports/` | Delivery plans and reports |
| `src/` | SPA: routing, static-page rendering, theme, scroll and motion behaviour |
| `src/chat/` | Chat launcher, panel, transcript, streaming reveal |
| `src/observability/` | Browser analytics and error-capture contracts |
| `worker/` | Cloudflare Worker: chat API, chat contract, conversation inspector |
| `migrations/` | D1 schema migrations |
| `scripts/` | Corpus build, resume build (PDF/DOCX), production smoke canary |
| `.agents/skills/` | Design and animation skills used when working on the site |

## Prerequisites

- [Bun](https://bun.sh) 1.1.29 (pinned via `packageManager`)
- Python 3 (the content tests are `unittest`)
- A Cloudflare account with Wrangler access, for `preview` and `deploy`

## Getting started

```bash
bun install
```

Copy the example environment files and fill them in:

```bash
cp .env.example .env && cp .dev.vars.example .dev.vars
```

`.env` holds public Vite build flags (observability toggles, archive
hostname). `.dev.vars` holds Worker secrets for local runs — at minimum
`ANTHROPIC_API_KEY` and `RATE_LIMIT_KEY`. Neither file is committed.

Run the SPA with Vite (fast, no Worker — the chat API is unavailable):

```bash
bun run dev
```

Run the full stack, SPA plus Worker, against local D1:

```bash
bun run db:migrate && bun run preview
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Build corpus, start Vite on :5173 |
| `bun run build` | Build corpus, produce `dist/` |
| `bun run preview` | Build, then serve SPA + Worker via `wrangler dev` on :8787 |
| `bun test` | Corpus build, `bun test`, and the Python content tests |
| `bun run corpus` | Regenerate `src/generated/corpus.js` only |
| `bun run resume` / `resume:docx` | Rebuild the resume PDF and DOCX |
| `bun run db:migrate` / `db:migrate:remote` | Apply D1 migrations locally / in production |
| `bun run smoke:production` | Run the production canary against the live origin |
| `bun run deploy` | Build, migrate remote D1, verify migrations, `wrangler deploy` |

## Adding a page

1. Author the HTML under `docs/content/`.
2. Register its canonical path in `ROUTE_PATHS` in [src/routes.js](src/routes.js) —
   both the router and the in-content link interceptor read from there.
3. Add it to `SOURCES` in [scripts/build-corpus.mjs](scripts/build-corpus.mjs)
   so the assistant can cite it. Use `path: null` for assistant-only notes that
   have no public page.
4. Run `bun test`; the content tests check links, assets, and evidence
   references.

## Testing

```bash
bun test
```

This runs the JS/JSX unit tests colocated with their sources (`*.test.js`) and
the static-content tests in `docs/content/tests/`. The production canary
(`smoke:production`) is separate: it hits the live site and needs
`CHAT_EVALUATION_TOKEN`, and also runs every six hours in GitHub Actions
(see [.github/workflows/README.md](.github/workflows/README.md)).

## Deployment

`bun run deploy` builds, applies remote D1 migrations, lists them for
confirmation, then deploys. Production secrets are set out of band:

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Same for `RATE_LIMIT_KEY`, `CHAT_EVALUATION_TOKEN`, and the Access variables
that guard the private archive.

Two deliberate constraints in [wrangler.jsonc](wrangler.jsonc):

- `workers_dev: false` and `preview_urls: false` — the Worker is reachable only
  through explicit custom domains, so Cloudflare Access cannot be bypassed via
  an alternate hostname.
- `run_worker_first` lists `/api/*` and `/conversations*` — without it the SPA
  asset fallback would answer API requests with `index.html`.

## Private conversation archive

`/conversations` is an operator-only transcript inspector. It is excluded from
the public route registry and is mounted only in local development or on the
exact hostname in `CONVERSATION_ARCHIVE_HOSTNAME` (`admin.kwamina.fyi`), behind
Cloudflare Access. Localhost is admitted without Access so the inspector stays
usable during development.

## Observability

Telemetry is diagnostic only and must never delay rendering, streaming, or
persistence. Several integrations are implemented in the repository but stay
disabled until their provider readiness checklist is recorded — that is what
the `*_READY` flags in `.env.example` gate. The privacy contract (bounded,
allowlisted dimensions; no URLs, bodies, chat text, headers, or IPs) is defined
in [docs/observability.md](docs/observability.md); read it before adding a
signal.
