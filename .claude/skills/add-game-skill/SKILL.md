---
name: add-game-skill
description: ai-simulator の「会得式スキル」（回帰＝ローグライクをまたいで永続する、主人公ハル専用のパッシブ）を src/domain/skills.ts の SKILLS 配列に追加するためのスキル。ユーザーが「（ゲームの/キャラの/会得式の）スキルを増やして／追加して」「新しいスキルを作って」「ハルのスキルを足して」などと、このシミュレータ内のスキルを増やしたい文脈で言ったときに使う。注意: これは Claude Code のスキル（.claude/skills/）を作る話ではなく、シミュレーション内のゲーム要素を足す話。両者を取り違えない（過去に skill-creator を誤起動した実績あり）。/add-game-skill でも発火。
---

# add-game-skill スキル

ai-simulator の **会得式スキル**（`src/domain/skills.ts` の `SKILLS` 配列）を1つ以上追加するための手順。

## 大前提：何を作る話なのか取り違えない

「skill を増やして」には2通りある。**必ずどちらか確定してから動く**（過去に取り違えて `skill-creator` を誤起動した）。

- **このスキルが扱うのはゲーム内要素**＝主人公ハルが経験で会得し、回帰（ローグライク）をまたいで永続するパッシブ。`src/domain/skills.ts` の `SKILLS: SkillDef[]` に1要素足すのが仕事。
- Claude Code 自体のスキル（`.claude/skills/<name>/SKILL.md`）を作る話ではない。それは `skill-creator`。
- 文脈が曖昧なら一言確認する。「ハル」「会得」「霊力」「回帰」「キャラ」等の語があればゲーム内要素。

## ドメイン背景（設計判断の土台）

- 会得式スキルだけが回帰をまたいで永続する（記憶・成長値・異能は周回でリセット）。**効果はすべて主人公ハルにのみ適用**される。
- `SkillDef`（`src/domain/types.ts`）の形：
  - `id`: 一意な文字列（snake_case）。
  - `name` / `description`: 表示名と「習得条件＋効果」の説明（日本語）。`SkillsPage.tsx` がそのまま全件描画するので UI 改修は不要。
  - `scope`: `"loop"`（1周ごとに未習得カウンタをリセット）か `"career"`（周をまたいで蓄積）。
  - `threshold`: 進捗がこの値に達したら習得。
  - `measure: (ctx: SkillTickContext) => number`: その日のハルの結果から進捗増分を返す（0で寄与なし）。
  - `effect: SkillEffectRaw`: 習得後に効く効果。
- `measure` が読めるのは `ctx.hero`（`CharacterTickResult`）。よく使うフィールド：
  - `hero.action`（`Action`: `forage`/`rest`/`share`/`talk`/`steal`/`deceive`/`move`/`follow`/`purify`/`guard`/`threaten`）
  - `hero.targetId`（対人行動の相手）/ `hero.energyAfter` / `hero.died` / `hero.paramsAfter`（`altruism`/`independence`/`trust`）
  - `hero.rewardEvents[].channel`（`achievement`/`bond`/`comfort`/`thrill`/`stress`）/ `hero.moved` / `hero.forageDraw`
  - 存在しないアクション名（例: `reflect`）を条件にしない。意味が近い既存アクション（内省なら `rest`）に寄せる。

## 効果（effect）の種類と、足りないときの配線

既存の `SkillEffectRaw` フィールド（`src/domain/types.ts`）：
`loadReduction`（日次負荷 −n）/ `forageBonus`（集霊取れ高 ×割合, 例0.15=+15%）/ `shareSelfReduction`（分け与えの自己消費を軽く, +nで消費減）/ `startEnergyBonus`（周開始時 霊力 +n）/ `startTrustBonus`（周開始時 信頼 +n）/ `startAltruismBonus`（周開始時 利他 +n）。

**既存フィールドで表現できるなら、追加配線は不要**（`skills.ts` への追記だけで完結）。

**新しい効果が要るとき**は、過去に `startAltruismBonus` を足したときと同じ4点を必ず揃える（1つ漏れると無言で効かない）：

1. `src/domain/types.ts` の `SkillEffectRaw` に optional フィールドを追加（コメントで意味を書く）。
2. 同 `SkillEffects`（合算後の実効型）に必須フィールドを追加。
3. `src/domain/skills.ts` の `noSkillEffects()` に初期値（0 / 倍率なら 1）を追加。
4. 同 `aggregateEffects()` に合算行（`if (e.xxx) eff.xxx += e.xxx`）を追加。
5. **実際に効かせる消費側**を必ず書く。開始時ボーナスなら `src/domain/campaign.ts` の `freshWorldFor()`（`hero.params.*` は `clampParam` で挟む）。tick 中に効く効果なら `src/domain/engine.ts` の `skillEffects` を読む箇所（`isHero` 判定の付近：`forageMult`/`loadReduction`/`shareSelfReduction` の実例がある）。
   - 「型だけ足して消費側を書き忘れる」が最悪。必ず効果が現れる場所まで通す。

## 作る手順

1. **取り違え確認**（上記）。曖昧なら確認する。
2. 追加したいスキルの **名前・条件・効果** を固める。テーマはハル（成長軸=利他 / 異能=観の眼 / 独占を憎み殻を破る）に沿わせる。複数同時でもよい。
   - 既存5+α と役割が被らないか `SKILLS` を一読する。`scope`/`threshold` のバランスも既存に倣う（loopは3前後、careerは数〜30）。
3. `src/domain/skills.ts` の `SKILLS` 配列末尾に `SkillDef` を追記する。
4. 既存 `effect` で足りなければ、上の「新しい効果が要るとき」の1〜5を全部やる。
5. **型チェック**: `bunx tsc --noEmit`。
   - 既存の無関係なエラー（例: `appearance` 不足など作業前から出ているもの）と、自分の変更起因のエラーを切り分ける。自分の追加分（skills/types/campaign/engine）に新規エラーが無いことを確認する。
6. **動作確認**: `bun run sim --days 6 --mock --director`。最後まで回り、クラッシュしないこと。
   - 効果が見えやすい条件があれば `--set` で寄せて確認してもよい（例: 開始ボーナス系は周回が回らないと見えにくい点を理解しておく）。
7. ユーザーに、追加したスキル（名前/条件/効果/scope/threshold）と、新効果を配線したかどうかを簡潔に報告する。閾値・効果量は調整可能だと添える。

## やりがちな失敗

- `reflect` 等、存在しない `Action` を条件にする → 近い既存アクションに寄せる。
- 新効果の型だけ足して消費側（engine/campaign）を書かず、無言で効かない。
- `SkillsPage.tsx` を触ろうとする → `SKILLS` を全件自動描画するので不要。
- `push` はしない。コミット/プッシュはユーザーの指示があってから（その時は push スキルに従う）。
