# 30-Day Countdown — LLM Ensemble Simulator

A TypeScript + bun web app. It uses an LLM to drive several ayakashi (妖, spirit beings) through a spirit-vein world set in Kyoto, one day (= one tick) at a time, and lets you watch what unfolds. The end goal is a watch-only public website (YouTube streaming has been discontinued).

> The current spec is this file and [`docs/`](docs/README.md).

## Quick Start

```sh
bun install
bun run dev      # http://localhost:5566 (default: Claude Code backend)
```

### Requirements

- [bun](https://bun.sh) 1.3+
- **Default (`claude-code`)**: the [Claude Code](https://claude.com/claude-code) CLI must be installed and logged in locally
- **Only when using `ollama`**: `ollama serve` running and the model pulled
  ```sh
  ollama pull qwen2.5:7b-instruct
  LLM_BACKEND=ollama bun run dev
  ```

### Local development (without burning tokens)

`bun run dev` / `bun run start` spin up an autonomous worker on startup that keeps hitting the LLM up to 10 times per day-tick (the streaming model). During development this just drains tokens, so iterate as: **"seed whatever state you want → view the UI without the worker → advance only as far as you need."**

```sh
# 1) Seed an initial state of your choosing (free with mock / even with a real LLM this is the only spend)
bun run sim --config examples/harsh.json --days 3 --save

# 2) View the UI (no autonomous worker = zero LLM calls; just renders the latest run in the DB)
bun run view            # http://localhost:5566

# 3) Want to see more? Advance the run from where it left off, then reload (2)
bun run sim --resume --days 1 --save
```

- `bun run view` = starts the server with `WORKER_AUTOSTART=0` (no autonomous worker). The autonomous behavior of production `start` is unchanged.
- `sim --resume` = restores the latest run from `data/world.db` and advances it by `--days N` **from where it left off**, appending to the same run (existing days are not recomputed = no wasted re-billing even with a real LLM). `--resume` presumes persistence, so `--save` can be omitted.
- Add `--mock` (no LLM) when you just want a quick check of numbers/UI. Details: [docs/cli.md](docs/cli.md) / [docs/env.md](docs/env.md).

## Overview

Ayakashi with different cores are placed in the same world, where encounters, fallings-out, and struggles over resources emerge. The first loop begins with Haru alone; companions unlock as Haru grows.

- **Haru** — an exorcist ayakashi who despises the monopolization of the spirit veins. Growth axis: altruism. Protagonist of the regressions
- **Nagi** — a binding ayakashi who fears abandonment. Growth axis: independence
- **Kai** — a starving half-ayakashi who trusts no one. Growth axis: trust
- **Sora** — a drifting ayakashi who puts down roots nowhere. Growth axis: trust
- **Shiori** — a shrine-keeping divine messenger bound by an old promise. Growth axis: independence

TS code guarantees all numeric outcomes (load, balance, death, stages), while judgments rooted in core and temperament are delegated to the LLM. The world has a 30-day deadline, and disasters intensify with each passing day. If the barrier is not ready for the "Great Calamity" (大禍) on Day 30, the world regresses and restarts from Day 1 (roguelike). Because the barrier can shelter only Haru alone, the first morning Haru repels the Great Calamity is the "Lone Dawn" (独りの暁) — every companion has fallen, and Haru acquires the hidden skill "Beacon of Dawn" (暁の迎え火) to return to the loop one more time. The next morning the Calamity is repelled, the beacon calls all the fallen companions back, the loop of regressions is severed, and the story always concludes with everyone alive (fin — the world stops advancing thereafter). The conditions for becoming able to repel it have "all characters unlocked + Kokoro fulfilled" woven in, so the story's completion and fin always coincide.

## Documentation

See [`docs/`](docs/README.md) for details.

| Topic | Document |
|---|---|
| Directory layout & tech stack | [docs/architecture.md](docs/architecture.md) |
| World rules, actions, locations, tempo | [docs/game-rules.md](docs/game-rules.md) |
| Characters, the Director, guardian deities, Kokoro | [docs/characters.md](docs/characters.md) |
| Persistence (Drizzle / SQLite) | [docs/database.md](docs/database.md) |
| API & UI pages | [docs/api.md](docs/api.md) |
| Environment variables | [docs/env.md](docs/env.md) |
| Switching LLM backends | [docs/llm-backend.md](docs/llm-backend.md) |
| CLI (`bun run sim`) | [docs/cli.md](docs/cli.md) |
| Deployment (Railway) | [docs/deploy.md](docs/deploy.md) |
| Secret scanning (gitleaks) | [docs/secrets.md](docs/secrets.md) |
| Image generation (gpt-image) | [docs/image-gen.md](docs/image-gen.md) |
| RunPod Serverless research | [docs/runpod-serverless.md](docs/runpod-serverless.md) |
