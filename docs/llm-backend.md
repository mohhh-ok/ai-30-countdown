# LLM Backend Switching

LLM calls are consolidated in the switching layer at `src/llm/backend.ts`, selected via the environment variable `LLM_BACKEND`.

| `LLM_BACKEND` | Description | Default model |
|---|---|---|
| `claude-code` (**default**) | Via the local **Claude Code CLI** (`claude -p`). Runs on Max subscription auth | `haiku` (change with `CLAUDE_CODE_MODEL`) |
| `ollama` | Local **Ollama** (free, unlimited, somewhat slow) | `qwen2.5:7b-instruct` (change with `OLLAMA_MODEL`) |

## Claude Code Backend

The default. The [Claude Code](https://claude.com/claude-code) CLI (`claude`) must be installed and logged in locally.

**Beware of billing accidents**: do not put `ANTHROPIC_API_KEY` in your environment. If the key is present, `claude` runs with API key authentication (pay-as-you-go) rather than OAuth subscription auth (official behavior). `backend.ts` strips the key from the env it passes to `claude`, but for safety, do not write it in `.env` either.

## Ollama Backend

```sh
ollama pull qwen2.5:7b-instruct
LLM_BACKEND=ollama bun run dev
```

Example of switching to a lighter model:
```sh
LLM_BACKEND=ollama OLLAMA_MODEL=qwen2.5:3b-instruct bun run dev
```

## Policy in Production

In production (public operation) as well, we **use `claude -p` (the Claude Code CLI) directly**. It runs on Max subscription auth.
(As of 2026-06-15, `claude -p` consumes monthly Agent SDK credit even on a subscription — see the "LLM 呼び出し方針" (LLM call policy) section in CLAUDE.md.)
For past investigation notes on self-hosting, see [runpod-serverless.md](runpod-serverless.md) (not adopted).

## Behavior When Hitting a Usage Limit (session/weekly limit)

Under subscription operation, you can hit a session/weekly usage limit. When this happens, **rather than performing a fake day with fallback default actions and leaving it in the DB, we abort that tick safely** (agreed 2026-06):

- `backend.ts` inspects `claude`'s failure output, identifies usage-limit messages ("You've hit your session limit", etc.), and throws a typed `UsageLimitError` (`src/domain/types.ts`).
- Each provider (decide / director+guardian / dialogue / onecall) retries and then falls back on ordinary failures, but **only `UsageLimitError` is not swallowed and is re-thrown**, aborting the whole tick.
- Because `runTick` mutates the world destructively, on abort the in-memory world is left half-advanced and dirty.
  The worker in `server.ts` catches this and **rolls back from the DB's last snapshot via `Campaign.restore`** (since saveTick/saveRunState never ran, the DB is intact). It then waits `LIMIT_BACKOFF_MS` (default 15 minutes) plus the normal interval and **retries the same day**. The worker itself does not stop.
- In the CLI (`bun run sim`), `UsageLimitError` is not caught and the process dies. The days saved so far remain in the DB, so after the limit recovers you can resume from where you left off with `sim --resume`.
- Note: the session/weekly limit wording has been confirmed against the official error reference, but **the actual wording for Agent SDK credit exhaustion (starting 2026-06-15) has not been confirmed**. The credit-related patterns are caught broadly by guesswork, so if you actually observe exhaustion, update the regex in `isUsageLimitMessage` in `backend.ts` with the real wording.
