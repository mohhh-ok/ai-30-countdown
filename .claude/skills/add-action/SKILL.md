---
name: add-action
description: ai-simulator の妖たちが選べる「行動（Action）」——集霊/休息/分与/語りかけ/奪う/欺く/移動/寄り添う/祓う/庇う/脅す のような1日1つ選ぶ行為——を新しく追加するためのスキル。ユーザーが「行動を増やして／追加して」「新しいアクションを足して」「キャラの行動を増やして」「○○できるようにして（例: 祈る・隠れる・贈る）」など、シミュレータ内で妖が取れる行為の種類を増やしたい文脈で言ったとき、または /add-action で発火。注意1: これは Claude Code のスキル（.claude/skills/）を作る話ではない（それは skill-creator）。注意2: 回帰をまたいで永続するハル専用パッシブ「会得式スキル」を足す話でもない（それは add-game-skill）。「行動／アクション」なら本スキル、「会得スキル／パッシブ」なら add-game-skill。
---

# add-action スキル

ai-simulator の **行動（`Action`）** を1つ以上追加するための手順。行動とは、毎ティック各妖が1つ選ぶ行為（`forage`/`rest`/`share`/`talk`/`steal`/`deceive`/`move`/`follow`/`purify`/`guard`/`threaten`）。

## 大前提：何を作る話なのか取り違えない

「○○を増やして」には紛らわしい3通りがある。**必ず確定してから動く**。

- **このスキル＝行動（Action）**。妖が1日に選ぶ行為の選択肢を増やす。`src/domain/types.ts` の `Action` 型に1つ足すのが起点。
- **会得式スキル（パッシブ）** を増やす話なら → `add-game-skill`。回帰をまたいで永続するハル専用の効果。
- **Claude Code 自体のスキル**（`.claude/skills/`）を作る話なら → `skill-creator`。
- 文脈が曖昧なら一言確認。「行動」「アクション」「○○する（動詞）」「選べる手」ならこのスキル。

## ドメイン背景（設計判断の土台）

- 数値の確定（負荷・収支・クランプ・死亡・段階・移動の妥当性）は **`engine.ts` が保証**し、行動の選択は LLM（本番）/ mock（テスト）が提案する。新行動も「決定論パートで効果を確定」する流儀に従う。
- 行動を性質で分類してから配線すると漏れない：
  - **単独か対人か**：対人（同室の相手が要る）なら `NEEDS_PARTNER=true`。単独なら `false`。
  - **報酬チャネル**（`src/domain/types.ts` の `RewardChannel`）：`achievement`(達成) / `bond`(絆) / `comfort`(安らぎ) / `thrill`(背徳) / `stress`(負・抗体つかない)。新行動の「気分への効き」をどれかに当てる。
  - **禁忌か**：芯に背く行為（奪う/欺く相当）なら `FORBIDDEN_ACTIONS` に入れる。グレー（脅す等）は入れない。
  - **特殊な移動を伴うか**：`follow` のように「離れた相手を追って動く」なら step3 で個別解決が要る（後述）。

## 触る順番とチェックリスト（漏らすと無言で効かない）

`Action` を使う網羅マップ（`Record<Action,…>` と `switch`）は **TS が未対応を弾く**ので型チェックで気づける。だが engine の報酬・記憶・観客ビューは **if/else 連鎖で default に落ちる**ため、足さないと型は通るのに無言で素通りする。順に通す：

1. **`src/domain/types.ts`**
   - `Action` ユニオンに追加。`ACTIONS[]`（検証の正。`decide.ts`/`onecall.ts` の `asAction` はこれ基準なので **LLM 入力検証は自動対応**）。`ACTION_LABELS`（`Record<Action>`・日本語ラベル）。必要なら `FORBIDDEN_ACTIONS`。
2. **`src/domain/rules.ts`**
   - `NEEDS_PARTNER`（`Record<Action>`・対人=true）。`actionEffect()` の `switch` に `{ self, partner }`（本人/相手の霊力増減。move 系は0）。報酬量が要るなら `REWARD` 定数に追記。
3. **`src/domain/engine.ts`**（中核。下の各ステップに対応する箇所へ）
   - **step3 行動解決**：移動や特殊解決が要る行動はここ。`follow` を範に取れ（相手を全生存者から選び、離れていれば `stepToward` で1歩動かし、同室なら留まる。専用 Map に相手を控える）。
   - **step4 効果確定**：`actionEffect` の self/partner は共通処理が適用するが、**プール操作や肩代わり等の特殊効果はここに足す**。範例: `purify`（その地の `populace.daku` を清霊へ還す）/ `guard`（同室の被守護者への steal/deceive/threaten の負ダメージを庇い手へ転送する `guardedBy` マップ）。
   - **step5.6 報酬**：自分の行動由来の `raw.push({channel,label,base})` を if/else に追加。相手が受ける報酬/被害は「自分を狙った者」ループ（`actorsTargeting`）に追加（例: `threaten` された側の `stress`）。
   - **step6 記憶＆結果**：エピソード記憶の文面（`memo`）に分岐を追加。対人なら `isPersonal` 条件に加え、`targetId`/`targetName` が出るようにする（`follow` のように相手が別 Map なら表示用の相手を別途解決）。
4. **`src/llm/prompt.ts`**（LLM に新行動を説明する）
   - `ACTION_NOTES` に1行（いつ・どう使うか）。世界ルールの導入文（対人行動の列挙）。`placeBlock` の同室行（「語りかける／…は誰かに向けてできる」）。`targetId` のスキーマ説明（**2か所**：全員版と単体版）に対人なら行動名を加える。
5. **`src/llm/mock.ts`**
   - `--mock` でも新行動が発火するよう、満足時の候補リスト（抗体で選ぶ `cand.push(...)`）に条件付きで足す。これがないと mock 検証で一度も実行されない。
6. **`src/web/components/FrontStage.tsx`**（観客ビュー）
   - `actStory`（場面用）と `briefAct`（早回し用）に case を追加。**観客ビューは数値・意図・囁き・報酬内訳を一切出さない**（CLAUDE.md の鉄則）。物語の言葉だけ。報酬の内訳は楽屋ビュー＝`rewardEvents` にだけ出る（こちらは追加配線不要、step5.6 が供給する）。
7. **`README.md`**
   - 行動を列挙している箇所（対人行動の括弧書き等）を実態に合わせて更新。

## 検証（必ずやる）

1. **型チェック**：`bunx tsc --noEmit`（exit 0 を確認）。網羅マップ・switch の漏れはここで出る。
2. **メカニクスの直接テスト**（最重要。mock は抗体で行動が選ばれにくく、新行動が偶発的にしか出ないため、engine を直接叩いて確かめる）。一時ファイルに以下の型のハーネスを書いて `bun` で実行する：
   - `createInitialCharacters()`（`src/domain/characters.ts`）＋ `placesCopy()`（`src/domain/places.ts`）で `WorldState` を自作（全員を同じ地に集め、`energy` を高めにして対人を試しやすくする）。
   - 各キャラの `action`/`targetId` を固定で返す自前 `DecisionProvider` を渡して `runTick` を呼ぶ。
   - 期待値を確認：本人/相手の `energyDelta`、`rewardEvents` のラベル、`moved`/`targetName`、プール（`populace.sei/daku`）の増減。`makeRng(seed)` を渡すと天候が再現可能（ただし `rollNewEvents` が稀に疫病等を足し、負荷が増えてズレて見えることがある＝バグではない）。
   - 確認できたら一時ファイルは消す。
3. **通し確認**：`bun run sim --days 12 --mock`（複数キャラを出すなら `--set nagi.currentPlaceId=… --set kai.energy=70` 等で同室・満足を作る）。最後までクラッシュせず回ること。

## やりがちな失敗

- 網羅マップ（`NEEDS_PARTNER`/`actionEffect`/`ACTION_LABELS`）は型で守られるが、**engine の報酬・記憶・FrontStage は if/else なので足し忘れても型が通る**。default 素通りに注意。
- `targetId` スキーマ説明は **prompt.ts に2か所**ある。片方だけ直して不整合になりがち。
- 観客ビュー（FrontStage）に数値や報酬内訳を出してしまう → 楽屋ビュー（TickLog/`rewardEvents`）との混同。観客には物語の言葉だけ。
- mock の候補に足し忘れ、`--mock` 検証で新行動が一度も出ず「動いたつもり」になる。
- `decide.ts`/`onecall.ts` を手で直そうとする → `ACTIONS` 配列基準なので不要。
- `push` はしない。コミット/プッシュはユーザーの指示があってから（その時は push スキルに従う）。
