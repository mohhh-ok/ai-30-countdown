# API Endpoints and UI Pages

## API

Read-only (a watch-only site). Progress is driven solely by the server's internal autonomous worker; APIs that mutate state are not exposed publicly.

| Method | Path | Description |
|---|---|---|
| GET | `/api/state` | Current world state, plus the logs and chronicle for the current regression |
| GET | `/api/loops/:loop` | The story of a given regression (the ticks of that loop, on demand) |
| GET | `/api/character/:id` | A character's trajectory across all loops (thin rows from `char_metrics`) |
| GET | `/api/health` | Backend connectivity and model name |

### Asset Serving

| Path | Description |
|---|---|
| `/assets/characters/:file` | Character art (WebP/PNG; sanitized, Cache-Control 1 day) |
| `/assets/places/:file` | Place art (same as above) |
| `/assets/title.webp` | Title logo (Japanese version; `/assets/title-en.webp` is the English version) |
| `/assets/og.jpg` | OGP share card image (a 1.91:1 crop of title-en.webp, referenced by the og:image in index.html; JPG as an exception to the webp rule, because LinkedIn does not support WebP) |
| `/assets/favicon.png` | Favicon (a face crop of haru.webp, 180×180; PNG as an exception to the webp rule, because Safari does not support WebP favicons) |

## UI Pages (hash routing)

Hash-based routing is handled in `src/web/router.ts`.

| Hash | Page | Component |
|---|---|---|
| `#/` | Home (current regression) | `FrontStage` / `TickLog` / `CharacterCard`, etc. |
| `#/loop/:n` | The story of the Nth regression | `LoopPage` |
| `#/char/:id` | Per-character page (across all loops) | `CharacterPage` |
| `#/skills` | Skill list (acquirable, persistent) | `SkillsPage` |
| `#/souls` | Kokoro list (the altruistic heart; current state of every character) | `SoulsPage` |

You jump to a regression via the "Nth regression" selector (`LoopSelect`) in the home screen's date field and at the top-right of a loop page.
Selecting the latest (in-progress) regression takes you to Home (`#/`). The old regression list page (`#/loops`) has been removed.

### Audience View and Backstage View

The home screen has two display modes, toggled via SiteNav (Home = front / Status = backstage / Debug = log).

- **Audience view (`FrontStage.tsx`)**: the front shown to the audience on the public site. It does not surface numbers, whispers, moods, harvest manipulations, or directorial intent. The only thing surfaced from the Director is `director.narration`.
- **Backstage view (`TickLog.tsx`)**: the backstage for development and observation. Here you can see intent (`演出: …`), whispers, the numbers behind harvest manipulation, LLM timing, and so on.
