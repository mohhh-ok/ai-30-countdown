# Characters and the Direction System

## Characters (an ensemble cast)

Ayakashi (妖) with differing cores are placed into the same Kyoto spirit-vein world, and out of this come encounters, missed connections, and struggles over spirit veins. In the first loop there is only Haru. When Haru's growth and skill achievements satisfy the unlock conditions, new beings join from the next regression onward.

### Haru (present from the start)
- **Core**: A calm, taciturn ayakashi of purification (the Eye of Insight) who hates the monopolizing of spirit veins
- **Background**: Once lost their kin in a struggle over spirit veins
- **Growth axis**: altruism
- **Starting placement**: Kibune-no-tani (a remote valley deep in the mountains)
- **Talent**: The Eye of Insight — reads spirit veins and presences to the last detail; adept at gathering (forage)
- **Protagonist of the regression**: When Haru runs out of strength, the world rewinds. Skills and Kokoro carry over across loops

### Nagi (unlock condition: Haru acquires 1 skill)
- **Core**: A bright, doting ayakashi of binding, of shrine-maiden (miko) lineage (the Power of Binding), who fears being abandoned
- **Background**: Once exiled from the group she belonged to
- **Growth axis**: independence
- **Starting placement**: Kamogawa-no-kawara (the riverbed, a place where people gather)

### Kai (unlock condition: any of altruism ≥ 70 / acquiring "Sever the Solitude" / acquiring 3 skills)
- **Core**: A starving half-ayakashi (devourer) who will steal to survive and trusts no one
- **Background**: An eater of spirits. The catalyst of the story
- **Growth axis**: trust
- **Starting placement**: Fushimi-no-Inari (a gambler's ground)
- **Frenzy (transformation)**: When isolation and betrayal (trust falling to the floor, being rejected again and again / mounting solitude) pile up, Kai snaps into a "frenzy," the restraint on `steal`/`devour` comes off, and the land is devoured fiercely. If Haru acquires the "Quelling Art" (`quellPower`) and performs `purify` in the same spirit-land, the frenzy is quelled; in loops where the quelling fails, the art is grown so that the next loop can save Kai — the twin gate to "barrier `wardPower` vs. the Great Calamity" (for details see `docs/game-rules.md`)

### Sora (unlock condition: 7+ regressions AND acquiring 4 skills, including "Eye of Insight, Honed")
- **Core**: A wandering ayakashi who puts down roots nowhere. Comes and goes, and laughs at attachment
- **Background**: On the day war and famine burned the village, was the only one to ride the wind and escape alive
- **Growth axis**: trust — can Sora trust someone and put down roots?
- **Starting placement**: Kibune-no-tani

### Shiori (unlock condition: acquiring "Binding Hands" AND acquiring 5 skills)
- **Core**: A shrine-guardian divine messenger bound by an old promise. Strong in duty, unable to forgive herself
- **Background**: The shrine she swore to protect has decayed, and the master she was to guard is gone
- **Growth axis**: independence — from bondage toward her own will
- **Starting placement**: Ohara-no-kakurezato (the hidden hamlet of Ohara)

## A character's internal model

Each character has two layers: personality (long-term) and mood (short-term).

### Growth parameters (personality, long-term)
- **altruism / independence / trust** (0–100). They move only by ±1–5 as the result of experience. The core never changes.

### Stages (growth-axis thresholds)
| Stage | Range |
|---|---|
| Budding | 0–39 |
| Wavering | 40–69 |
| Mature | 70–100 |

### Energy attachment `satiety`
The spirit-power level regarded as fullness. The higher it is, the more attached the type (Haru = 55 / Kai = 50); the lower it is, the more easily a type finds slack (Nagi = 28).

### Reward / antibody system (mood, short-term)
- Actions yield results — events — that pay out rewards (gathering = achievement; conversation clicking / sharing spirit power = bonds; resting / fullness = peace; stealing = transgression).
- **Antibody model**: `effective reward = base × (1 − antibody/100)`. The more reward you gain, the more antibodies build up and dull it (boredom); if you stop, they decay and recover.
- **Antibodies differ per individual** (per-channel sensitization rate + decay rate). Haru is the attached type, slow to tire of achievement; Nagi never tires of bonds and quickly tires of solitary achievement.
- **Mood**: elation (achievement + transgression) / warmth (bonds) / peace / stress. Stress never gains antibodies and accumulates.
- Mood and the "degree of boredom" are translated into words and passed into the prompt = rewards are tied back into actions.

### Kokoro (the heart of altruism)
- Each time someone shares spirit power with you (you receive a `share`), a receipt count accumulates (`soulCounters`, persisted in the DB), and at certain counts a multi-tiered "heart of altruism" buds.
- A budded heart is injected into the prompt as a sentence keyed to its tier, leaning the character toward actions like giving, conversing, and staying close (it does not touch the parameters directly).
- Only the protagonist Haru can carry it over across regressions. Other ayakashi reset each loop.
- The kinds are managed in `SOUL_KINDS` in `src/domain/soul.ts`. The UI shows the tiers and each ayakashi's current state on the `#/souls` page.
- One whose altruism has matured (altruism ≥ 60) is deterministically prompted to give whenever they see a weakened partner in the same room, as long as they can keep the "minimum line for not dying" (`GIFT_FLOOR` = 5) even after giving (−10) — this produces the "first gift" that becomes the seed of Kokoro. If the giver becomes the one who runs dry, Haru's acquired skill "Hands That Never Run Dry" (spirit reflection) saves the share's source.

## The Director

An optional LLM Director who intervenes **only in the environment** so the story becomes entertaining. It does not touch a character's core, actions, or free will.

- At the curtain-raise of each day it reads the **tension level** (calm / stagnant / tense / tragic) and performs **deciding the weather, temporarily manipulating the bounty of places, and the curtain-raise narration**.
- Example: detecting deadlock (stagnant), it shakes things up with a poor harvest; just before tragedy (tragic), it grants a reprieve to create a set piece. It also detects "two who stay apart and never meet" as deadlock.
- Always enabled on the Web. On the CLI it is enabled with `--director`.

### Guardian deities and impulses

Since the Director cannot operate a character's actions directly, it works through **guardian deities**.

- The Director instructs the guardian deities via `directives` on "how it wants to move this one."
- A **guardian deity** is attached to each character and converts that instruction into a **first-person whisper rooted in the character's core and mood**. The whisper is injected into the action-decision prompt as "a voice that suddenly surfaces in the mind (you may follow it or resist it)."
- **Impulse**: when days of not following the whisper pile up (`whisperIgnored` exceeds a threshold), an "uncontrollable impulse" fires. It is the safety net for when a small model cannot translate a whisper into action.

The chain `environment (Director) → whisper (guardian deity) → it builds up into an impulse → encounter → conversation → the subtleties of relationships` reliably breaks deadlock and generates drama.

### Camera (lead role, spotlight)

Behind the scenes everyone is simulated equally, but what the audience follows is the viewpoint of "the one whose story is moving most right now." The Director picks a **lead role (spotlight)** each day.

- The Director turns the camera on the person harboring conflict, crisis, decision, encounter, or betrayal, so it never bores by aimlessly holding the same viewpoint.
- When the lead runs out of strength and exits, the camera moves to the one among the survivors who is hardest to look away from.
- When the Director is unspecified / disabled, the engine automatically makes the survivor with the largest "size of the set piece" that day (death, stage change, movement, impulse, interpersonal action, strong emotion, large swing in spirit power) the lead.
- On the Web the lead-role card is highlighted.
