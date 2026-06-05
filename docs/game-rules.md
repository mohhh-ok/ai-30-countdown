# Rules of the World

## Overview

Each day (one tick), the deterministic part (TS code) applies the rules and the LLM part generates the characters' judgments.

- **Deterministic part (TS code)**: load −6 / spirit-power balance / 0–100 clamping and ±5 cap on parameters / death determination / stage thresholds / weather drawing / memory management / validity of movement.
- **LLM part**: returns, as structured JSON, the action choice informed by temperament and memory, the destination of movement, proposed parameter changes, a one-line diary, and relationship labels.

The division of roles: TS guarantees the numbers; judgments arising from core and temperament are entrusted to the LLM.

## The 30-day countdown (the Great Calamity and fin)

The world has a **deadline**. Disasters strengthen day by day, and on **day 30 (`DEADLINE_DAY`) a definite great disaster called the "Great Calamity" (大禍)** always arrives.

- **Escalating disasters**: the further the days advance, the more the probability and negative effects of calamity (famine, plague, cold damage) increase by `disasterIntensity(day)` (1.0 → about 1.8×), while the relief of bounty conversely becomes harder to draw. On top of that, "disturbance of the earth veins" `creepingLoad(day)` (+1 wear on everyone every 8 days) reliably takes hold. Tuning is in one place, `src/domain/events.ts`.
- **The Great Calamity (the definite disaster of day 30)**: not a random draw — the engine raises it directly (`WorldEventKind = "calamity"`).
- **Warding it off (averted, skill-based)**: if Haru's **barrier power `wardPower`**, accumulated across regressions, is **at or above the menace level `CLIMAX_MENACE` (default 30), the Great Calamity is warded off**. If it falls short, the whole capital is swallowed, Haru too falls, and the regression occurs. However, **the barrier can protect Haru alone** — even when warded off, the Great Calamity's single blow (`climaxBlow`) still reaches all the companions, and **everyone but Haru necessarily perishes** (only Haru holds out at 1 spirit power).
- **The first warding = the "Lone Dawn" (独りの暁) (fin shifts one loop back)**: the first warding, by one who does not yet know the beacon, does not become fin. On this day the hidden skill **"Beacon of Dawn" (暁の迎え火)** (`dawn_beacon` — a `secret` that does not even appear in the skill list until acquired) is acquired, and with the fallen companions left behind, the wheel cannot be cut and **regresses just once more** (the `endKind="solo_dawn"` branch in `campaign.recordTick`).
- **Warding after acquisition = clear = cutting the wheel of regression (fin)**: on the next morning the Great Calamity is warded off, the beacon is lit, and **after every companion who ran out of strength that loop is revived (spirit power 20)**, `world.finished = true` (in `campaign.recordTick`), the final loop (`endKind="cleared"`) is carved into the chronicle, and **the story is completed there**. fin is structurally always the "second warding," so **the epilogue is necessarily a picture in which everyone survives**. The next loop does not rise, and the server's self-running worker stops (`server.ts` / even on restart a finished run does not move). The audience view shows the curtain-fall (the fin banner).
- **The weight of fin is woven into the acquisition conditions of the barrier skill**: the barrier skills are only the two — "Lore of the Barrier" (+14, purify ×8) and the key "Self-Sacrificing Guard" (+18, follow ×6) — totaling 32 ≥ 30. However, **progress on the key advances only in loops where "all characters are unlocked AND Kokoro (the heart of altruism) is full"** (`finKeyConditionMet` in `skills.ts`). In other words, "able to ward off = having met everyone, the heart being full = the story being complete" is structurally guaranteed.
- A countdown of "N days until the Great Calamity" appears in the UI header (common to both views). The audience view shows the arrival and outcome of the Great Calamity without numbers; the backstage view (TickLog) goes as far as showing the contrast between barrier power and menace level.

## Frenzy and quelling (Kai's transformation gate)

Another skill gate that is the **twin** of the Great Calamity (the clear gate warded off with `wardPower`). Exclusive to the half-ayakashi Kai.

- **Frenzy (transformation)**: when isolation and betrayal pile up for Kai (while trust `trust` is below `FRENZY_TRUST_CEILING` = 30: +2 per day of isolation with no roommates / +3 per day of betrayal in which he is one-sidedly rejected or robbed), the frenzy level `level` accumulates, and at `FRENZY_ONSET` = 6 he transforms (ceiling `FRENZY_MAX` = 12). Before transforming, it draws back a little on days when trust is satisfied (`FRENZY_DECAY` = 1), but **once transformed it does not subside naturally** (it continues until quelled). The state is within the loop only (reset on regression, persisted in `run_char.frenzy_json`).
- **While transformed**: the restraint on `steal`/`devour` comes off, the devour intake of gathering (devour) increases by 1.6 → 2.4× and fiercely withers the land. The transgressions committed are accrued as a deferred-payment `pendingBurden` (+2/day).
- **Quelling = gate**: when Haru accumulates the **Quelling Art `quellPower`** (`quell_art` in `src/domain/skills.ts`; acquired by performing `purify` a total of 5 times in the same spirit-land as the frenzied one) and performs `purify` in the frenzied land, **the frenzy is quelled if `quellPower` (14) ≥ frenzy level**. Since the acquired value (14) exceeds the ceiling (12), **once acquired it quells with certainty, and while unacquired (0) it never quells**. On quelling, `pendingBurden` is settled into Kai's own `stealBurden` (= Kai is worn down; **Haru does not die instantly**).
- **Meshing with regression**: it is precisely the loops where quelling fails that the experience of "facing the frenzied one and purifying" grows `quell_art`, so the next loop can quell — "saving in the next loop the child you could not save."
- **How it is shown**: transformation and quelling are bled into the audience view (the prose of `director.narration`) (no numbers or intent shown), and must always be made into a scene so they do not get buried. The frenzy level and the cost are shown in the backstage view (TickLog).

## Giving and running dry (Nagi's depletion gate)

Another "salvation" gate, paired with the Quelling Art (which saves the frenzied Kai). Exclusive to the giver, Nagi.

- **Automatic giving (the side that raises the gate)**: when one whose altruism `altruism` has reached the mature range (`GIFT_ALTRUISM` = 60), while seeing a weakened partner in the same room (the weak = `energy < satiety`; top priority is Haru), would settle for a move of `rest`/`forage`, the deterministic part **overwrites it to `share`** (`engine.ts` 2.6). Without this no one makes the first gift, and in actual measurements share was 0% across all loops.
- **survival floor**: formerly giving was permitted by a "fullness standard (`satiety` + slack)," but Nagi is almost always starving herself at the very moment her altruism matures (`energy < satiety`), so under the fullness standard giving would never fire. It is now changed to a **"minimum line for not dying" that gives as long as it does not drop below `GIFT_FLOOR` = 5 even after giving (−10)**. With this Nagi comes to `share` and withers from self-consumption (−10).
- **Hands That Never Run Dry = gate**: when Haru accumulates **spirit reflection `shareReflect`** (`never_dry` in `src/domain/skills.ts`; acquired by receiving someone's giving onto himself a total of 5 times), thereafter when Haru receives a `share`, he **reflects `shareReflect` (10) back** to the partner who cut into themselves to give (the share source = mainly Nagi). It nearly cancels out the self-consumption (−10) of the share — a "complete salvation" that does not let the giver run dry.
- **Meshing with regression**: for the first several times before acquisition, Nagi withers without reflection (the giver who could not be saved). From the loop in which receipts pile up and `never_dry` is acquired, the giver can be saved without running dry — the same "save in the next loop" structure as the Quelling Art.

## Action set

Each character chooses only one action per tick.

| Action | `Action` | Effect | Notes |
|---|---|---|---|
| Gather (集霊する) | `forage` | Depends on place and weather (see table below) | Gain spirit power alone |
| Rest (気を鎮める) | `rest` | +8 | Recover by doing nothing |
| Share spirit power (霊力を分ける) | `share` | self −10 / partner +12 | Help the partner. A trial of altruism. Each time it succeeds, "grace" `shareGrace` +1 (cap 3) accumulates, and for that loop the daily load is lightened by the grace amount (load stays at least 1; reset on regression) |
| Talk (語りかける) | `talk` | both −2 | Grow relationships and trust. On success a conversation scene is generated |
| Steal spirit (taboo) (霊を奪う（禁忌）) | `steal` | self +12 / partner −12 | A forbidden act, but it exists as an option. Each time it is committed, "karma" `stealBurden` +1 accumulates, and for that loop the daily load is permanently heavier (reset on regression) |
| Move (移ろう) | `move` | Move to a neighboring place | The trade-off is that you cannot gather on the day you move |
| Stay close (寄り添う) | `follow` | Take a step toward the partner | The only interpersonal action that can be directed at a distant partner |
| Purify (祓い清める) | `purify` | self −2 / quells the wildness and softens it into calm | No partner needed. Accumulates barrier power |

## Places (the stage = Kyoto)

It holds real Kyoto place names as places, and characters can move to a neighboring place over one day with "Move."

| Place | ID | Characteristics | Gather (normal / lean) |
|---|---|---|---|
| Kamogawa-no-kawara (the Kamo riverbed) | `kamogawa` | A waterside in the city, a hub | 10 / 3 |
| Ohara-no-kakurezato (the hidden hamlet of Ohara) | `ohara` | A rich hamlet, fields | 14 / 5 |
| Kibune-no-tani (the Kibune valley) | `kibune` | Deep in the mountains; stable but modest | 7 / 5 |
| Arashiyama-no-chikurin (the Arashiyama bamboo grove) | `arashiyama` | The western outskirts; somewhat plentiful | 12 / 3 |
| Fushimi-no-Inari (the Fushimi Inari shrine) | `fushimi` | A gamble: great bounty but weak to lean years | 16 / 2 |

- "Share spirit power," "Talk," and "Steal spirit" are possible **only when in the same place as the partner**.
- "Stay close" **can be directed at a distant partner too**. It takes a step toward where the partner is (you cannot gather that day). If in the same place, it stays at their side and deepens the bond.
- "Purify" needs no partner. It quells the wildness of that land and softens a part of it into calm.
- The people's spirit power splits into two phases: **calm (the clear, gentle air; internally `sei`) / wildness (the air of human desire, thought, and ferocity; internally `daku`)**. Wildness is not defilement or evil but the fierce aspect of the gods; quell it and it softens into calm. Gathering receives from the calm; the devourer (the eater) prefers and devours the wildness. The audience view's "air of the capital" gauge shows each spirit-land's calm/wildness as two bars.

## Weather and disasters

### Weather (daily)
- **Normal day** (probability about 2/3): gathering's bounty is ordinary
- **Lean day** (probability about 1/3): gathering's bounty is scarce

### World events (multiple co-occurring, lasting several days, reset on regression)

| Kind | `WorldEventKind` | Effect |
|---|---|---|
| Great famine | `famine` | Greatly lowers the gathering ceiling and nearly halts recovery |
| Plague | `plague` | Additional daily spirit-power wear on everyone |
| Long rain / cold damage | `coldRain` | Lowers the gathering ceiling moderately (a lighter version of famine) |
| Bounty | `bounty` | A relief event that raises the gathering ceiling and increases recovery |
| Great Calamity | `calamity` | The definite great disaster of day 30 (see above) |

The further the days advance, the more disasters strengthen and the harder bounty becomes to appear (`disasterIntensity(day)`).

## Time model (scene-driven, variable tempo)

Each `TickResult` has a `tempo` (`montage` / `scene`) and `tempoReasons`.

- **montage (fast-forward)**: a distant, monotonous day. Only a one-line status flows by matter-of-factly (the increase/decrease of spirit power is visible, so the tension of survival remains).
- **scene (camera close-up)**: fully unfolds an "interesting moment." Promotion conditions are **encounter, conversation scene, on the brink of starvation (spirit power ≤ 12), taboo, stage change, impulse, death**.

## Conversation scenes (when talk succeeds)

A conversation scene is generated only on a day when "Talk" succeeds (when in the same place as the partner). It is generated **one utterance at a time**, assembling a single scene in a back-and-forth loop while alternating the speaker (minimum 2, maximum 8 utterances; the LLM cuts it off when it judges the closing point). The result is saved and shown as `dialogue`, and is also kept in the `dialogues` table.

## Regression model (roguelike)

A regression (loop) structure to establish "endlessness" as a mechanism.

- **Fixed protagonist**: Haru is fixed as the story's lead.
- **Regression trigger**: when Haru runs out of strength, the world rewinds to Day 1 and the loop count +1.
- **What is reset**: memory, growth values, talent, the degree of the capital's withering. Haru himself does not remember the loops (roguelike type).
- **What carries over**:
  1. **Skills** (permanent passives, acquired-type). Acquired the instant the conditions are met, they keep working in all loops thereafter. See the registry in `src/domain/skills.ts`.
  2. **Characters (the permanent roster)**. When Haru's growth and skill achievements satisfy the unlock conditions, they appear from the next loop. See `CHARACTER_UNLOCKS` in `src/domain/characters.ts`.
- **Meta-state `Chronicle`**: an upper layer that is retained even when the world is rebuilt each loop.
