# Headless Execution / CLI

Without standing up a server, you can pass parameters and initial data and run N days in one go.

```sh
bun run sim --help                                  # list of options
bun run sim --days 8 --mock                          # no LLM needed; 8 days instantly
bun run sim --days 10 --seed 42                      # make weather reproducible
bun run sim --config examples/harsh.json --mock      # override initial data from a file
bun run sim --set haru.energy=40 --set places.kibune.forage.normal=3 --mock
bun run sim --days 3 --set nagi.currentPlaceId=kibune # put two together to trigger dialogue
bun run sim --days 8 --mock --json                   # output results as JSON
bun run sim --days 6 --save                          # also save results to SQLite
bun run sim --resume --days 1 --save                 # advance one day from the latest run (no recompute)
```

## Local Development Flow (a way to proceed without burning tokens)

`bun run dev`/`start` runs the autonomous worker, which hits the LLM up to 10 times per tick (a steady drain). During development, work in a loop of **"create a seed → view without the worker → advance from there"**.

```sh
bun run sim --config examples/harsh.json --days 3 --save   # 1. create a seed in any initial state
bun run view                                               # 2. browse the UI without the worker (zero LLM)
bun run sim --resume --days 1 --save                       # 3. advance only as far as you need from there → reload step 2
```

- `bun run view` = start the server with `WORKER_AUTOSTART=0` (no autonomous worker). See [env.md](env.md) for details.
- `--resume` runs `Campaign.restore` on the latest run in `data/world.db` and advances **from there** by `--days N`, appending to the same run. Existing days are not recomputed, so even with a real LLM there is no wasteful re-billing. If there is no run to restore from, it stops with an explicit error.

| Option | Description |
|---|---|
| `--days <n>` | Number of days to advance (default 8) |
| `--mock` | Run fast with simple logic instead of the LLM (for verifying numbers, movement, deaths, and dialogue wiring) |
| `--director` | Enable the Director |
| `--seed <n>` | Random seed for weather (the same seed reproduces the weather sequence) |
| `--config <path>` | Initial data JSON. Partially overrides `characters`/`places` per id; unknown ids are added as new |
| `--set <path=value>` | Individual override (repeatable). Example: `haru.params.altruism=90` |
| `--save` | Also save results to `data/world.db` (creates a new run) |
| `--resume` | Restore the latest run in `data/world.db` and advance `--days N` days from there, appending to the same run (existing days are not recomputed). Since saving is implied, `--save` may be omitted |
| `--no-dialogue` | Turn off dialogue generation (prioritize speed) |
| `--json` | Output results as JSON to stdout |

Example of initial data JSON (`examples/harsh.json`):
```json
{
  "days": 10,
  "seed": 7,
  "characters": {
    "haru": { "energy": 45 },
    "nagi": { "energy": 45, "currentPlaceId": "ohara" }
  },
  "places": { "kibune": { "forage": { "normal": 4, "lean": 2 } } }
}
```

## Reachability Audit

A read-only diagnostic that checks whether any acquirable skills or character unlocks are effectively unreachable. It does not advance the world.

```sh
bun run scripts/audit-reachability.ts          # human-readable report
bun run scripts/audit-reachability.ts --json   # machine-readable
```

Look at it in two layers:
- **Static**: probe `measure`/`isUnlocked` with maximal context to detect "0 under any action" / "false even with all conditions maxed out" = definition bugs
- **Dynamic**: from the actual progress in `data/world.db`, detect "progress=0 after N total loops" = balance issues. Uses the `skill_audit` audit log (recorded by the worker every tick)
