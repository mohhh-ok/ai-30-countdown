# Documentation Index

> The source of truth for the specification is this `docs/` directory and the root `README.md`.

## Design & Specification

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | Directory layout, tech stack, styling policy |
| [game-rules.md](game-rules.md) | World rules (30-day countdown, actions, locations, weather, disasters, pacing) |
| [characters.md](characters.md) | Characters, internal models, Kokoro, the Director, guardian deity, camera |
| [database.md](database.md) | Persistence (Drizzle ORM / SQLite), table list, aggregation examples |
| [api.md](api.md) | API endpoints, UI page list |
| [env.md](env.md) | Environment variable list |
| [llm-backend.md](llm-backend.md) | LLM backend switching (Claude Code CLI / Ollama) |

## Operations

| Document | Contents |
|---|---|
| [cli.md](cli.md) | Headless execution (`bun run sim`), reachability audit |
| [deploy.md](deploy.md) | Deployment policy (Railway), constraints when public |
| [secrets.md](secrets.md) | Secret scanning (gitleaks / pre-commit) |

## Images & Assets

| Document | Contents |
|---|---|
| [image-gen.md](image-gen.md) | Generating character art, location art, and the title logo (OpenAI gpt-image) |

## Research & Ideas

| Document | Contents |
|---|---|
| [research/README.md](research/README.md) | Experiment logs observing real LLM behavior in numbers (action-choice distribution, etc.) |
| [runpod-serverless.md](runpod-serverless.md) | RunPod Serverless research notes (past investigation from before the YouTube streaming feature was dropped; read with care) |
| [ideas.md](ideas.md) | Future ideas, backlog |
