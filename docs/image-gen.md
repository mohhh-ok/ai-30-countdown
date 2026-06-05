# Character Art / Image Generation Notes

## Models We Use
- Image generation uses OpenAI's image API (metered/pay-as-you-go). This is a separate track from the policy for the LLM itself (see CLAUDE.md).
- Authentication is via `OPENAI_API_KEY` (loaded automatically from `.env` by bun).
- Pick the model **based on the use case**:
  - **`gpt-image-2` (default)** … the usual choice. Art with a background included.
  - **`gpt-image-1` + transparency** … use this when you want a transparent-background PNG (gpt-image-2 does not support transparency).
- The current character art uses **`gpt-image-1` with transparency and a pop art style**.

## Generation Script
`scripts/gen-character-art.ts`

```sh
# Default (gpt-image-2, background included)
bun scripts/gen-character-art.ts            # all characters
bun scripts/gen-character-art.ts haru nagi  # only the specified characters

# Transparent + pop style (gpt-image-1) ← the current character art is generated this way
IMAGE_MODEL=gpt-image-1 IMAGE_TRANSPARENT=1 bun scripts/gen-character-art.ts
```

- Switch via env: `IMAGE_MODEL` (default `gpt-image-2`), `IMAGE_TRANSPARENT=1` (turns transparency on).
- Based on each character's core / talent (`src/domain/characters.ts`), the script's
  `LOOKS` table assembles the appearance prompt. The art style is unified via the shared `STYLE_BASE`
  (**bright, poppy, cute anime style**).
- Output path: `assets/characters/<id>.webp` (saved after converting PNG→WebP, as described below).

## Notes on Transparency (verified on real hardware: 2026-05)
- **`gpt-image-2` does not support `background:"transparent"`**
  (`400 image_generation_user_error` / `param:"background"`).
- **`gpt-image-1` does support transparency**. When you send `background:"transparent"`,
  it returns an image with an alpha channel (`srgba`) — confirmed on real hardware.
  → If you want a transparent-background character standee, use `gpt-image-1`.

## Other API Notes
- The response is always `data[0].b64_json` (no `url` is returned). Decode the base64 and save it.
  No need to specify `response_format`. → Code written for the DALL·E 3 family that assumes a returned URL cannot be reused.
- Use `size` of `1024x1024` (square).
- Each image takes tens of seconds to generate. Running them in parallel can hit rate limits, so generation is sequential.
- There is no retry mechanism. If one fails, re-run just that character by specifying its id.

## Output Files (WebP Conversion)
- The source PNG is heavy at ~1.5–1.9MB each, so **convert to WebP with `cwebp -q 80` and save that**
  (the script does this automatically: save PNG to a temp file → `cwebp` → emit `.webp` → delete the temp PNG).
  - The result shrinks to ~85–250KB (about a 90–95% reduction). Transparency (alpha) is preserved.
  - Dependency: `cwebp` (on macOS, `brew install webp`).
- Images live under `assets/`. This is separate from `data/` (SQLite) and is not subject to `.gitignore` (these are assets that may be committed to the repo).

## Web Integration Status
- Serving: `server.ts` has a `/assets/characters/:file` route (returns PNG/WebP;
  the filename is sanitized to prevent path traversal, with a 1-day `Cache-Control`).
- Display: **already shown as the profile image on the character page (`CharacterPage.tsx`)**
  (`/assets/characters/<id>.webp`; characters without art are hidden via `onError`).
- Also shown on `CharacterCard.tsx` (the home cards) via the `CharAvatar` component.

## Existing Characters
| id | Name | Role |
|----|------|------|
| haru | Haru | A calm exorcising ayakashi (妖) who hates the monopolization of spirit veins (the Eye of Insight) |
| nagi | Nagi | A cheerful binding ayakashi of shrine-maiden lineage who fears abandonment (the Power of Binding) |
| kai | Kai | A starving half-ayakashi who devours spirits and trusts no one (the Devourer) |

## Place (Background) Art
- Script: `scripts/gen-place-art.ts`. Generates background art from the place definitions (each `appearance` in `src/domain/places.ts`).
  ```sh
  bun scripts/gen-place-art.ts                 # all places
  bun scripts/gen-place-art.ts kamogawa ohara  # only the specified places
  ```
- Unlike character art, these are made **with a background, no people, and in landscape orientation**. The default is `gpt-image-2` at `1536x1024` (no transparency needed, so gpt-image-1 is not used). You can switch `IMAGE_MODEL` / `IMAGE_SIZE` via env.
- The art style is unified via the shared `STYLE` (bright, poppy anime style matched to the character art; no people or text).
- Output path: `assets/places/<id>.webp` (PNG→WebP conversion).
- Serving: `server.ts` has a `/assets/places/:file` route (sanitized, same as character art).
- Display:
  - In the backstage view's "Map of Kyoto" (`PlacesMap.tsx`), shown as the thumbnail on each place card (places without art hide only the image via `onError`).
  - In the audience view (`FrontStage.tsx`), the art for the protagonist's current location (`placeId`) is laid into the background of the lead `.hero` slot with `object-fit: cover`. A dark overlay (`.hero::after`) is layered on top so the body text stays readable, and places without art fall back to the base color via `onError`.

## Title Logo
- Script: `scripts/gen-title-art.ts`. Generates just one title banner to show in the top topbar.
  ```sh
  bun scripts/gen-title-art.ts
  ```
- A landscape banner with a background, no people, and no transparency. The default is `gpt-image-2` at `1536x1024` (no transparency needed, so gpt-image-1 is not used). You can switch `IMAGE_MODEL` / `IMAGE_SIZE` via env.
- The prompt bakes the Japanese title "30日のカウントダウン" into the center. The gpt-image family tends to garble Japanese glyphs, so if it comes out garbled, switch to the approach of a Latin-letter logo plus Japanese overlaid on the HTML side (decide after seeing the result).
- Output path: `assets/title.webp` (PNG→WebP conversion). It is a single file, not per-id.
- Serving: `server.ts` has a fixed GET route for `/assets/title.webp` (no dynamic parameter, so no sanitization needed).
- Display: shown as an `<img>` in the topbar (`.title-logo`) of `App.tsx`. Sized to match the height of the other topbar UI.

## Great Calamity (Per-Ending) Art
- Script: `scripts/gen-calamity-art.ts`. Per-ending banners placed above the Great Calamity (大禍) staging in the audience view.
  ```sh
  bun scripts/gen-calamity-art.ts             # all variants
  bun scripts/gen-calamity-art.ts solo saved  # only the specified variants
  ```
- Variants and outputs (a set of single files directly under assets):
  - `arrival` → `assets/calamity.webp` (the Great Calamity arrives — a shared pre-ending cut, no people)
  - `lost`    → `assets/calamity-lost.webp` (couldn't be stopped; Kyoto was swallowed — no people)
  - `solo`    → `assets/calamity-solo.webp` (the lone dawn — references Haru's character art and features Haru)
  - `saved`   → `assets/calamity-saved.webp` (the dawn where everyone survives — references all character art and features them)
- Default `gpt-image-2` at `1536x1024` (landscape banner). You can switch `IMAGE_MODEL` / `IMAGE_SIZE` via env.
- **For solo/saved, which feature characters, the existing character art is passed to `images/edits` as "reference images"** (multiple files attached to the multipart `image[]`). Verified on real hardware (2026-06): **`gpt-image-2` does support images/edits (multiple reference images)** (transparency is still gpt-image-1 only). The appearance follows the reference art but is not an exact match.
- Serving: the `/assets/:file` route in `server.ts` (only the `calamity` prefix is allowed, sanitized; other top-level files have fixed routes).
- Display: in `SceneMarks` of `FrontStage.tsx`, depending on the Great Calamity tick's ending (lost/solo/saved), `CalamityArt` shows the corresponding art at the very top of the staging (if not yet generated and it 404s, it disappears via `onError`, and the staging still works without art).
  Note: `arrival` (calamity.webp) currently has no permanent display target in the UI; **only the serving route is provided** (leaving room to repurpose it for a countdown, etc.).
