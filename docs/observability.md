# Site observability

This runbook defines the production signals, privacy boundary, ownership, and
release gates for `kwamina.fyi`. Telemetry is diagnostic only: a provider
failure must never delay page rendering, chat streaming, transcript replay,
persistence, or reservation cleanup.

## Current posture

| Surface | Authority | Repository status | Provider status |
| --- | --- | --- | --- |
| Browser render failures | Sentry browser project | Scrubbed root, live-chat, replay, global error, and rejection capture implemented | Disabled until readiness checklist passes |
| Worker and assistant lifecycle | Cloudflare Workers Observability | Structured, allowlisted lifecycle and refusal events implemented | Application logs enabled; request traces remain disabled pending envelope proof |
| Actionable Worker issues | Cloudflare Workers Observability | Fixed, scrubbed issue outcomes are emitted with lifecycle logs | Sentry forwarding is not wired pending request-envelope proof |
| Visits and Core Web Vitals | Analytics provider | Not enabled | Provider decision required; see “Visits decision” |
| Public and deep availability | Sentry uptime plus GitHub Actions | Repository smoke client and scheduled workflow | Monitors, protected environment, and alert routes require account configuration |

Do not describe a repository-ready integration as production-active until its
provider evidence is recorded below.

## Privacy contract

Allowed dimensions are deliberately bounded:

- canonical route or `unrecognized`;
- `local`, `preview`, `production`, or `evaluation` environment;
- `site` or `evaluation` source and `human` or `synthetic` run kind;
- fixed event, stage, outcome, and status-class values;
- immutable release and bounded assistant, corpus, and model versions;
- bounded durations and refusal occurrence counts;
- a fresh Worker-generated operation ID used only for incident correlation.

Never collect or forward query strings, hashes, referrers, raw URLs, request or
response bodies, chat text, exception messages, nested causes, cookies,
headers, raw IP addresses, user agents, caller hashes, thread credentials,
evaluation tokens, persistent anonymous IDs, or account/profile data. An
operation ID is not a visitor, session, or transcript identifier and must not
be used as a metric label.

Sentry session replay, product analytics, profiling, performance tracing,
breadcrumbs, default integrations, automatic request context, and client
reports stay disabled. Worker request traces stay disabled until a captured
production envelope proves that the allowed subset excludes every forbidden
field. Expected `400`, `409`, `413`, and `429` outcomes are bounded operational
counters, not exception issues.

## Signal map

| Question | Source and view | Filter or grouping |
| --- | --- | --- |
| Is the public site reachable? | Sentry uptime monitor and deep-canary page checks | Exact production origin |
| Are browser renders failing? | Sentry browser issues | Release, canonical route, render context, fixed outcome, safe stack fingerprint |
| Are chat requests admitted? | Workers application logs: `assistant.operation` and `assistant.refused` | Route, stage, outcome, status class, run kind |
| Does the model start and produce content? | Workers application logs | `MODEL_STARTED`, `CONTENT_STARTED`, `MODEL_FAILED`, `EMPTY_COMPLETION` |
| Does a turn complete durably? | Workers application logs | `PERSISTENCE_COMMITTED`, `TERMINAL_EMITTED`, then `SERVER_DURABLE_SUCCESS` |
| Is transcript replay healthy? | Workers application logs and deep canary | `REPLAY_STARTED`, `REPLAY_EMPTY`, `REPLAY_NONEMPTY`, `REPLAY_FAILED` |
| Are infrastructure limiters healthy? | Workers application logs | Fixed rate-limit binding, D1, and sweep outcomes |
| Are visits and Web Vitals healthy? | Pending analytics provider | Production human traffic and canonical routes only |

Dashboards must exclude `environment != production`, `source = evaluation`,
and `runKind = synthetic` from human-use views. Synthetic health gets its own
view. Do not build transcript-content, visitor-identity, session-funnel, or
answer-quality dashboards.

## Initial alerts

Low traffic makes percentage-only alerts noisy. Start with absolute events and
consecutive external failures:

| Alert | Trigger | Recovery | Owner |
| --- | --- | --- | --- |
| New browser render issue | First new or regressed production issue | Issue resolved and no recurrence after the next release | Site operator |
| Worker configuration or persistence failure | Any production actionable event | Successful durable canary and no new event in the confirmation window | Site operator |
| Public uptime failure | Provider-confirmed consecutive failed checks | Provider-confirmed recovery | Site operator |
| Deep canary failure | Two consecutive scheduled failures, or one manually confirmed failure | One complete page/API/chat/replay run | Site operator |
| Missed deep canary | No heartbeat within twice the configured schedule plus grace | Next authenticated heartbeat | Site operator |

Keep error-rate and latency-percentile alerts dashboard-only for the first 14
days. Enable them later only with a recorded minimum eligible-event count,
baseline, threshold, notification destination, and recovery rule. Alert titles
and notifications contain generic incident metadata and authenticated provider
links only—never event payloads or request details.

## Provider readiness checklist

Record the following in private delivery evidence before enabling collection:

- Cloudflare account/zone and Workers Observability view owner;
- Sentry organization, browser project, planned Worker project, uptime monitor, and
  least-privilege members;
- MFA posture, maximum retention, quotas, deletion/offboarding process, and
  notification destination for each provider;
- immutable release value and source-map access owner;
- GitHub `production` environment reviewers and the owners of
  `CHAT_EVALUATION_TOKEN`, `SENTRY_AUTH_TOKEN`, and any heartbeat secret;
- Anthropic spend cap, billing alert, canary cadence, and row-growth stop
  threshold;
- exported sentinel envelopes and alert notifications proving that forbidden
  values are absent.

`SENTRY_AUTH_TOKEN` is CI-only and must never reach the runtime bundle, Worker,
or deep-canary job. Enable `OBSERVABILITY_PROVIDER_READY=true` only after the
corresponding provider has passed this checklist.

## Visits decision

Cloudflare Web Analytics cannot currently meet this site’s approved SPA
contract: its supported SPA mode observes History API changes before TanStack
Router confirms rendering, and it exposes no supported manual canonical
pageview API. Enabling it would make unknown, failed, superseded, or hash-only
navigation behavior provider-owned rather than exactly-once and canonical.

Keep the beacon disabled until one option is explicitly approved:

1. accept Cloudflare’s automatic SPA semantics and relax the exact-once
   completed-navigation contract;
2. use full-document navigation with SPA collection disabled; or
3. select an analytics provider with an explicit manual pageview API that can
   receive only the shared canonical-route allowlist.

No custom telemetry endpoint or visit table may be introduced as a shortcut.

## Investigation

For a browser issue, start from the Sentry release, canonical route, render
context, and scrubbed frame location. Use the private source map to reach the
source line. Do not add request context to improve diagnosis.

For a chat or replay issue, copy its `op_…` operation ID from the response or
sanitized issue and search Workers application logs. Follow lifecycle outcomes
and durations across admission, model, stream, persistence, terminal, or replay
without opening transcript content. If the operation ID is absent, use bounded
release, route, outcome, and time filters; never substitute the thread ID.

If Sentry or Cloudflare telemetry is unavailable, diagnose using the other
independent sink and external canaries. Do not change user-visible availability
or retry behavior to restore telemetry.

## Release and rollback

1. Build and test with provider collection disabled.
2. Audit the deployable assets: hidden source maps must upload privately and
   then be deleted from `dist`.
3. Run privacy-sentinel and fail-open tests, the Worker dry run, and the
   migration audit.
4. Configure providers and the protected GitHub environment without enabling
   notifications.
5. Deploy with `bun run deploy`; do not bypass migration-first ordering.
6. Run the HTTP-only production smoke manually. Browser validation remains a
   separate user-owned step.
7. Inspect sanitized provider envelopes, one controlled source-mapped browser
   issue, one durable synthetic chat/replay, and alert delivery/recovery.
8. Enable absolute and consecutive alerts. Review the 14-day baseline before
   considering rate or percentile alerts.

Rollback code by restoring the previous Cloudflare Worker version. Disable the
provider flag or alert route independently if telemetry is unhealthy; user
flows must continue. No observability migration is currently required.

For removal, stop and deploy the writing endpoint or SDK first, verify the
deployment hostname and custom domain separately, and only then remove any
provider storage or destructive schema. Never treat custom-domain propagation
as immediate or telemetry delivery as an availability dependency.

## Retention and rotation

Use the shortest provider retention that supports incident response; do not
inherit an account default without recording it. Raw issues and lifecycle logs
should be shorter-lived than aggregate usage metrics. Evaluation transcripts
must be reviewed and removed under the same conversation-data policy, without
adding a privileged cleanup endpoint.

Rotate runtime DSNs/keys, CI source-map credentials, evaluation tokens, and
heartbeat secrets on owner change, suspected exposure, or the recorded regular
schedule. Re-run the sentinel, source-map, canary, and alert-route proofs after
rotation. Remove departed members, revoke old tokens, and record the deletion
date without copying secrets into the repository.

## Evidence record

For each production enablement, record privately: provider/account name,
project/site/monitor, view or saved-query link, owner, verification timestamp,
retention, alert route, controlled-failure result, recovery result, sentinel
audit result, source-map result, and canary run link. Repository documentation
defines the contract; it is not proof that mutable provider configuration is
still active.
