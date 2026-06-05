# Deployment Policy

## Railway

The deployment target is **Railway** (a managed PaaS that allows long-running processes).

- **Can stay resident**: The server-side worker advances the world one day at a time on its own, an always-on operating model (`workerLoop` in `server.ts` / the rest-based `WORKER_INTERVAL_MS`). Railway keeps processes running, so the self-running loop just works as-is.
- **No porting needed**: The bun runtime runs as-is, and `Bun.serve` and `bun:sqlite` work without modification.
- **Cheap**: The Hobby plan is $5/month, usable as resource credits. Since the app is mostly waiting on external LLM API calls (I/O) and its own CPU is largely idle, usage tends to fit within $5.

For persistence, place `data/world.db` on a Railway **volume**. Adjust the advance interval with `WORKER_INTERVAL_MS`.

## Setup record (deployed 2026-06-05)

Config files live at the repo root: `Dockerfile` (oven/bun + Claude Code CLI native install),
`railway.json` (healthcheck `/api/health`), and `.dockerignore`.

- Project `ai-simulator` / service `ai-30-countdown` (`railway add --service`).
- Volume: `railway volume add --mount-path /app/data`. The DB **starts fresh in production**;
  the local run is not carried over (decided 2026-06-05).
- Service variables:
  - `WORKER_INTERVAL_MS=7200000`
  - `PORT=5566` … **required**. Railway's healthcheck probes the port in the `PORT` variable,
    so without it the app boots fine but the healthcheck fails and the deploy ends up FAILED
    (we actually hit this).
  - `CLAUDE_CODE_OAUTH_TOKEN` … the subscription OAuth token (`sk-ant-oat01-…`) issued by
    `claude setup-token` (run on a local terminal). Paste it directly into the dashboard
    (never into chat logs or the repo). **Set it before enabling the worker** — without auth,
    claude failures count as "normal failures" and fallback fake days would be persisted
    into the fresh DB (only `UsageLimitError` aborts a tick).
- First deploy with `WORKER_AUTOSTART=0` to verify the public surface and auth →
  smoke-test with `railway ssh -- claude -p "ok" --model haiku` → set `WORKER_AUTOSTART=1`
  and redeploy.
- Deploys use `railway up --detach` (from the local directory, not GitHub integration).
- `railway domain -p 5566` generates a `-production`-suffixed subdomain; we renamed it to
  `ai-30-countdown` in the dashboard (Settings → Networking).
- CLI gotchas: `railway up` / `railway redeploy` may report `operation timed out` while the
  operation **actually fired server-side** — check `railway deployment list --json` before
  retry-spamming. `railway ssh` needs a one-time key registration (`railway ssh keys add`)
  plus `ssh-keyscan ssh.railway.com >> ~/.ssh/known_hosts`.

**The public URL is fixed as `https://ai-30-countdown.up.railway.app`** (agreed 2026-06).
The OGP tags in `index.html` (the absolute URLs in `og:url` / `og:image`) are baked in assuming this URL,
so be sure to match the Railway service name (subdomain) to it. If you change it, update index.html too.
The OGP is written **English-first** to suit the distribution channels (Show HN / Reddit / X) (the card image is `/assets/og.jpg`;
it is JPG as an exception to the webp-only rule, because LinkedIn does not officially support WebP og:image and the preview breaks).

## Production pacing and operation (leave it until fin)

- **Production runs at 1 tick / 2 hours (`WORKER_INTERVAL_MS=7200000`).**
  Rationale (measured data from 2026-06, across 14 regressions): average survival ≈15 days/loop, longest 22 days, a pace at which an audience that checks once a day can follow "about 12 days ≒ 0.8 of a loop." The lifespan until fin (= surviving to day 30 for the **second** time, cutting the chain of regression. Reaching day 30 the first time leads into the Lone Dawn (独りの暁), where you acquire the Beacon of Dawn (暁の迎え火) and run one more loop—see [game-rules.md](game-rules.md))
  is expected to be a little over a month (the Lone Dawn extends it by one loop; the range varies with survival rate).
  At 1 tick/hour a whole regression would pass in a single day and fin would come in about two weeks, so we don't use that.
- **Once it goes to production, leave it alone.** We do not intend to do balance tuning or DB resets (restarts) midway.
  Production started **fresh from run #1 on 2026-06-05** (the local run — barrier strength 32, fin-qualified — was not carried over); once it reaches fin, the worker auto-stops and keeps displaying the epilogue (fin banner + chronicle). After fin it remains as a read-only site.

## Constraints when public

- Do not expose state-changing APIs (POST) externally (to prevent tampering). Only read-only endpoints are published (see [api.md](api.md)).
- Advancing is done solely by the server-internal self-running worker and cannot be stopped from outside.
- The UI has no advance controls either; it just polls `/api/state` at a fixed interval to reflect the latest state.
