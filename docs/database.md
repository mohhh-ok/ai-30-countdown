# Persistence (SQLite / Drizzle ORM)

## Overview

State is stored in `data/world.db` via **Drizzle ORM** (the bun-sqlite driver of `drizzle-orm`). When the server restarts, it resumes from where the latest run left off.

- Source of truth for the schema: `src/schema.ts` (Drizzle table definitions)
- Reads and writes: `src/db.ts` (everything goes through drizzle; raw SQL / prepared statements and hand-written `CREATE TABLE`/`ALTER` have been retired)

## Schema management (drizzle-kit push)

Tables are materialized with `bun run db:push` (= `drizzle-kit push --force`). It also runs automatically when `dev`/`start`/`sim` start up (push runs first, then the main process launches).

To add a column, just edit `src/schema.ts` and run `bun run db:push` (no hand-written `ALTER` needed).

| Script | Role |
|---|---|
| `bun run db:push` | Apply `src/schema.ts` to the DB (`--force` = data loss auto-approved) |
| `bun run db:generate` | For when versioned migrations become necessary in the future (currently we use push) |
| `bun run db:studio` | Browse the DB in Drizzle Studio |

## Table list

### `runs` — Chronicle (one session spanning regressions)
Holds chronicle-level scalars (loop, day, weather, protagonist, Haru's peak altruism, etc.) as columns. A snapshot for restoration. Both the CLI (`sim`) and the Web app (`server`) save to this same table.

### `run_skill` — Skill progress
One row per skill. `acquired` (acquired) / `progress` (progress counter).

### `run_roster` — Permanent roster
Unlocked characters. One row per character.

### `run_char` — Mutable character state
Used to resume mid-loop. Holds spiritual power, growth values, mood, antibodies, whispers, relationships, memories, Kokoro (`soulCountersJson`), frenzy (`frenzyJson`; half-ayakashi Kai only), and so on. Immutable settings live in code as the source of truth. One row per character, overwritten in place.

### `run_place` — Mutable place state
Just how depleted the people's spiritual power is (`sei`/`daku`). Terrain, adjacency, and caps live in code as the source of truth. One row per place, overwritten in place.

### `run_event` — Environmental events
The calamities/blessings currently befalling the capital (reset on regression). On every save, all rows are wiped and re-inserted.

### `run_loop_summary` — Outcomes of past loops
Chronicle history. One row per loop. Records cleared/not-cleared, reached stage, acquired skills, and meta highlights.
In addition to the Japanese `cause_of_end` (source of truth), the outcome is also stored in structured form for display localization (`end_kind` = `cleared` (cleared) / `died` (succumbed) / `solo_dawn` (the Great Calamity (大禍) was purified but it is a Lone Dawn (独りの暁)); `end_place_id` = the id of the place where they succumbed). Old runs (unset) fall back to the Japanese text.

### `ticks` — Daily results
The `TickResult` for each day, stored as JSON, one row per day (identified by `loop`/`day`; on regression `day` resets to 1 each loop). The display log is assembled from this.

### `char_metrics` — Character metrics (normalized)
A thin, normalized row per day per character. For SQL aggregation of growth curves and action frequency.

### `dialogues` — Dialogue lines
That day's conversation, stored one row per utterance. `seq` preserves the order of utterances.

### `llm_timings` — LLM call timing
The duration of a single LLM call. For bottleneck analysis. The label (`decide:haru` / `dialogue` / `director` / `guardian`) distinguishes the call type.

### `llm_calls` — LLM invocation log
A row is left the instant a call fires (`status='started'`) and updated on completion. This makes in-flight calls visible.

### `skill_audit` — Reachability audit log
One row per tick. Records Haru's altruism, peak altruism, acquired skills, all skill progress, and unlocked characters over time. Used by `scripts/audit-reachability.ts`.

## Aggregation examples

```sh
# Trend of Nagi's independence
sqlite3 data/world.db "SELECT day, independence FROM char_metrics WHERE char_id='nagi' ORDER BY day;"

# Action frequency
sqlite3 data/world.db "SELECT name, action, COUNT(*) FROM char_metrics GROUP BY char_id, action;"
```

## Persistence wiring checklist

When adding a column, be sure to wire it through all of these:

1. Add the column in `src/schema.ts`
2. `charSaveToRow` in `src/db.ts` (insert values)
3. The select mapping in `loadLatestRun`
4. `CharSave` (`campaign.ts`)
5. The save/restore mapping

If any one is missing, the column is silently dropped on save.
