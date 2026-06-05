# Architecture

## Directory structure

```
src/
  domain/           World model and rules
    types.ts          Domain type definitions (Action / Weather / WorldState, etc.)
    characters.ts     Initial definitions of the cast; initial antibody/mood values
    places.ts         Place definitions, adjacency graph, movement utilities
    engine.ts         Deterministic processing of one tick (load, balance, clamps, death, stages)
    rules.ts          Rules for parameter changes (rewards, antibodies, mood)
    events.ts         Rolls and effects for weather/disaster/abundance (disasterIntensity / creepingLoad)
    campaign.ts       Chronicle, regression model, skill/roster management
    skills.ts         Registry of acquired skills (conditions, effects, progress measurement)
    soul.ts           Stage management of Kokoro (the altruistic heart)
    highlights.ts     Extraction of showcase moments / meta-events (rule-based)
  llm/              LLM backend switching, prompts, decisions
    backend.ts        Backend switching layer (claude-code / ollama)
    decide.ts         Action-decision prompts and LLM calls
    dialogue.ts       Generation of the dialogue drama (one utterance at a time, alternating)
    director.ts       The Director (weather, harvest manipulation, narration)
    guardian.ts       Guardian deity (generation of whispers)
    director_guardian.ts  Combined invocation of the Director + guardian deity
    prompt.ts         Shared prompt utilities
    mock.ts           Mock (simple logic that needs no LLM)
    ollama.ts         Ollama client
    onecall.ts        Process multiple decisions in parallel from a single process launch
    timing.ts         Timing and recording of LLM calls
    log.ts            LLM log
  web/              React UI
    index.html        Entry HTML
    main.tsx          React mount
    App.tsx           Routing, layout, SiteNav, TitleBlock
    router.ts         Hash router (#/ / #/loop/:n / #/char/:id, etc.)
    styles.css        Hand-written CSS (dark curtain, background art, brushwork, regression animation, etc.)
    charTheme.ts      Per-character theme colors
    util.ts           Shared frontend utilities
    components/       Shared components
      FrontStage.tsx    Audience view (the stage shown to the audience on the public site)
      TickLog.tsx       Backstage view (the behind-the-scenes view for development and observation)
      CharacterCard.tsx Character card
      CharAvatar.tsx    Character avatar
      ParamBar.tsx      Parameter bar
      PlacesMap.tsx     Map of Kyoto (place thumbnails)
      SceneFX.tsx       three.js particle effects
      Highlights.tsx    Display of showcase moments / meta-events
      LoopSelect.tsx    Regression jump select (the "Loop N" pill = select)
    pages/            Page components
      CharacterPage.tsx Per-character page (the arc across all loops)
      LoopPage.tsx      The story of a specific regression
      SkillsPage.tsx    Skill list
      SoulsPage.tsx     Kokoro list
  schema.ts         Drizzle table definitions (source of truth for the SQLite schema)
  db.ts             DB reads and writes (everything goes through drizzle)
  server.ts         Bun.serve (API + frontend serving + autonomous worker)
  sim.ts            Headless CLI (bun run sim)
  worldlock.ts      File lock that limits progression (writes) to world.db to a single process (double-launch guard)
scripts/
  audit-reachability.ts   Reachability audit
  bench-decide.ts         Benchmark for action decisions
  gen-character-art.ts    Character art generation
  gen-place-art.ts        Place art generation
  gen-title-art.ts        Title logo generation
assets/
  characters/       Character art (WebP)
  places/           Place art (WebP)
  title.webp        Title logo
data/
  world.db          SQLite database (covered by .gitignore)
```

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | [bun](https://bun.sh) 1.3+ |
| Language | TypeScript |
| DB | SQLite (bun:sqlite) |
| ORM | Drizzle ORM (drizzle-orm / drizzle-kit) |
| Frontend | React 19 + Tailwind v4 (hybrid) |
| 3D effects | three.js (particle effects in the audience view) |
| LLM | Claude Code CLI / Ollama (switchable) |
| Image generation | OpenAI gpt-image-1 / gpt-image-2 |

## Styling (CSS / Tailwind hybrid)

CSS is primarily hand-written in `src/web/styles.css`. On top of that, we **use Tailwind v4 alongside it in a hybrid fashion**.

- The `@import "tailwindcss";` at the top of `src/web/styles.css`, together with `[serve.static] plugins = ["bun-plugin-tailwind"]` in `bunfig.toml`, rides directly on bun's HTML import bundler (`import index from "./web/index.html"` in `server.ts`). No separate build step is needed, and `bun dev` HMR works.
- When to use which: write new and small parts in JSX with Tailwind utilities, and keep the existing elaborate effects (dark curtain, background art, brushwork, regression animation, etc.) in `styles.css`. Reference theme colors as arbitrary values (e.g. `bg-[var(--accent)]`).
- Note: calling `Bun.build` directly together with `bun-plugin-tailwind` segfaults on bun 1.3.11 (a Bun-side bug). Do builds via the `Bun.serve` / `bun dev` path (this app uses the serve path, so it is unaffected).
