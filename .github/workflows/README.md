# Production observability workflow

`production-observability.yml` is the external deep canary for `https://kwamina.fyi`. It runs every six hours and can also be dispatched manually. It does not run for pull requests or forks. The job uses the protected `production` GitHub environment so secret access can follow that environment's reviewer and branch policies.

The workflow receives only:

- `CHAT_EVALUATION_TOKEN` (required): authorizes the Worker to acknowledge the bounded assistant request as synthetic.
- `CANARY_HEARTBEAT_URL` (optional): a secret URL from an external cron monitor. It is called only after every check passes, and redirects are rejected.

The script pins the production origin in source. It checks the homepage, one nested canonical page, safe API rejection contracts, one fixed non-sensitive assistant turn, and durable replay. It never prints the evaluation token, thread credential, response body, prompt, or transcript content. Credential-bearing requests use manual redirect handling and the evaluation token is sent only to the fixed same-origin chat endpoint.

At a six-hour cadence the paid check creates at most 124 evaluation conversations in a 31-day month before manual reruns. Pause the schedule and investigate if either assistant spend exceeds $5 in a month or evaluation conversations exceed 150 in a month. Review evaluation-row retention monthly; remove bounded evaluation transcripts through the existing data-administration process rather than adding a privileged cleanup endpoint.

Configure the optional heartbeat with a lateness tolerance above the six-hour cadence (eight hours is the initial recommendation). Test notification delivery with one controlled failed manual run, then confirm the next successful run resolves the incident. The heartbeat provider and alert destination are external account configuration and are intentionally not created by this repository.
