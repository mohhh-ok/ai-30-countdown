# Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5566` | Server port |
| `LLM_BACKEND` | `claude-code` | LLM backend (`claude-code` / `ollama`). See [llm-backend.md](llm-backend.md) for details |
| `CLAUDE_CODE_MODEL` | `haiku` | Model for the `claude-code` backend (`haiku` / `sonnet` / `opus` / full ID) |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Model for the `ollama` backend |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama host |
| `DB_PATH` | `data/world.db` | Path to the SQLite database |
| `WORKER_INTERVAL_MS` | `1000` | Rest interval for the self-running worker (milliseconds). After completing one tick, rest N ms before the next. **In production set this to `7200000` (1 tick / 2 hours)** (see the pacing policy in [deploy.md](deploy.md)) |
| `LIMIT_BACKOFF_MS` | `900000` (15 min) | Additional wait (milliseconds) after a tick is interrupted and rolled back due to a subscription usage limit (session/weekly limit, etc.). After this wait plus the normal interval, the same day is retried (see the behavior on hitting limits in [llm-backend.md](llm-backend.md)) |
| `WORKER_AUTOSTART` | `1` | Whether to start the self-running worker when the server starts. `0`/`false` means it does not start = **UI viewing only, zero LLM calls** (for local development). `bun run view` uses this. Production `start` launches it as normal |
| `OPENAI_API_KEY` | — | For image generation (gpt-image). bun loads it automatically if placed in `.env` |
