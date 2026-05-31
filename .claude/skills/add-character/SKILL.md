---
name: add-character
description: ai-simulator に新しい登場人物（妖／キャラクター）を1体追加するためのスキル。src/domain/characters.ts の createInitialCharacters() にキャラ定義を足し、解放条件（CHARACTER_UNLOCKS）・表示色（charTheme）を配線し、最後に scripts/gen-character-art.ts でキャラ絵（webp）まで生成して完結させる。ユーザーが「キャラを追加して／増やして」「新しい妖を出して」「登場人物を足して」「○○っていうキャラを作って」「6人目を追加」などと言ったとき、または /add-character で発火。注意1: これは Claude Code のスキル（.claude/skills/）を作る話ではない（それは skill-creator）。注意2: 妖が選ぶ「行動（Action）」を足す話でもない（それは add-action）。注意3: ハル専用の会得式パッシブを足す話でもない（それは add-game-skill）。「登場人物／キャラ／妖を増やす」なら本スキル。
---

# add-character スキル

ai-simulator に **登場人物（`Character`）を1体追加**し、**キャラ絵の生成まで**を一気通貫でやる手順。

## 大前提：何を作る話なのか取り違えない

「○○を増やして」には紛らわしい候補が複数ある。**必ず確定してから動く**。

- **このスキル＝登場人物（キャラ／妖）**。`src/domain/characters.ts` の `createInitialCharacters()` に `Character` を1つ足すのが起点。画像生成まで含む。
- **行動（Action）** を足す話なら → `add-action`（妖が1日に選ぶ行為）。
- **会得式スキル（ハル専用パッシブ）** を足す話なら → `add-game-skill`。
- **Claude Code 自体のスキル**（`.claude/skills/`）なら → `skill-creator`。
- 文脈が曖昧なら一言確認。「キャラ」「登場人物」「妖」「○○（人名）を出して」なら本スキル。

## ドメイン背景（設計判断の土台）

- 京を舞台に複数の妖が暮らす。各キャラは **不変メタ**（芯・生い立ち・口調・異能・感受性など）と **可変状態**（霊力・成長値・現在地・気分）を持つ（`Character` 型＝`src/domain/types.ts`）。
- **出演の仕組み（重要）**：1周目の開始ロスターは**主人公ハルだけ**。他のキャラは `CHARACTER_UNLOCKS`（`characters.ts`）の解放条件を満たすと恒久ロスター（`chronicle.roster`）に加わり、**次の回帰の Day1 から登場**する（`src/domain/campaign.ts` が制御）。
  - したがって新キャラは原則 **`createInitialCharacters()` に定義を足し、かつ `CHARACTER_UNLOCKS` に解放条件を足す**の二段構え。これを忘れると定義はあるのに永遠に登場しない。
- キャラの設計は「芯（trauma）→ そこから引き出した処世術（initialLesson）→ それを揺さぶる成長軸（growthAxis）」の三点が背骨。数値（`sensitization`/`satiety`/`lonelinessSensitivity`/`params`）はこの人物像と整合させる。

## 触る順番とチェックリスト

### 1. `src/domain/characters.ts` — キャラ定義を追加（必須）
`createInitialCharacters()` の配列に `Character` を1つ足す。既存5体（haru/nagi/kai/sora/shiori）を範に、**全フィールドを埋める**（型が必須を弾くが、意味づけは手動）。要点：

- `id`（snake_case の一意 id）/ `name`（カタカナ表示名）。
- `core`（芯・一文）/ `background`（生い立ち）/ `initialLesson`（処世術）。
- **`appearance`**（**画像生成プロンプト・英語**。step4 の絵生成がこれを使う）。既存キャラの `appearance` と同じ粒度で、髪・目・衣装・手元のエフェクト・性格の佇まいを英文で。共通画風（pop・セルシェ・透過背景）は生成スクリプトが付与するので**ここには書かない**。
- `voice`（固定口調プロフィール。一人称・語尾・絵文字の癖まで具体的に。生成のブレ防止に効く）。
- `growthAxis`（`altruism`/`independence`/`trust` のどれを揺さぶる物語か）。
- `talent`（異能。`insight`/`bond`/`devour`/`none`。集霊のしかたに効く＝engine が解釈する既存値から選ぶ。**新しい異能名を勝手に作らない**＝engine 未対応で無言で効かない）。
- `satiety`（充足とみなす霊力水準）/ `sensitization`（チャネル別の飽きやすさ 0〜1）/ `clearance`（立ち直りの速さ）/ `lonelinessSensitivity`（孤独の効き）。人物像と整合させる（例：見捨てられ恐怖なら loneliness 高め）。
- `params`（`altruism`/`independence`/`trust` の初期値 0〜100）。
- `currentPlaceId`（**`src/domain/places.ts` に実在する id**＝`kamogawa`/`ohara`/`kibune`/`arashiyama`/`fushimi` のいずれか。新しい地が要るなら places.ts に Place を足してから。`neighbors` の整合も取る）。
- `antibodies: freshAntibodies()` / `mood: freshMood()` / `energy`（60前後）/ `alive: true` / `episodicMemory`（芯を一文で）/ `diary: []` / `relationLabel`（相手への初期スタンス）。

### 2. `src/domain/characters.ts` — 解放条件を追加（持ち越しキャラにするなら必須）
`CHARACTER_UNLOCKS` に `CharacterUnlock` を1つ足す。1周目から勝手には出ない設計なので、**登場させたいならここが必須**。

- `id`/`name`、`describe`（どんな成長で世界に現れるか＝物語の地の文）、`requirement`（観客に見せる「あと何をすれば現れるか」の平易な説明）。
- `isUnlocked: (ctx) => boolean`。`ctx` は `{ acquired: SkillId[]; peakAltruism: number; loop: number }`。既存例に倣う（スキルN個会得／利他ピーク到達／周回数）。**存在しない指標を参照しない**。

### 3. `src/web/charTheme.ts` — 表示色（任意・推奨）
`PALETTE` に `id: { bg, fg }` を1行。無くても id 由来で自動採色されるが、既存5体は手調整色なので**揃えるなら追加推奨**。`bg` は暗い地色＋`fg` は淡い文字色のトーンで。

### 4. キャラ絵を生成（このスキルの肝・画像生成まで）
`appearance` を使って絵を作り、`assets/characters/<id>.webp` を作る。UI（`CharAvatar.tsx` / `CharacterPage.tsx`）は `/assets/characters/<id>.webp` を参照するので、**ここまでやって初めて顔が出る**。

```bash
bun scripts/gen-character-art.ts <id>      # その1体だけ生成（課金が発生）
```

- 既定は **`gpt-image-1` + 背景透過**（`scripts/gen-character-art.ts`）。透過 webp（`srgba`）で出る。
- 要 `OPENAI_API_KEY`（`.env` から bun が自動ロード）。`cwebp` で webp 化するので `cwebp` も要る。
- **課金が発生する**ので、生成は引数で **新 id だけに絞る**。既存を作り直さない。
- 不透過・別モデルにしたい場合のみ env で上書き：`IMAGE_MODEL=gpt-image-2 IMAGE_TRANSPARENT=0 bun scripts/gen-character-art.ts <id>`。
- 画像生成方針の詳細は `CLAUDE.md` の「画像生成方針」と `docs/image-gen.md` を参照。

### 5. ドキュメント
登場人物を列挙している箇所（`README.md` のキャラ紹介など）があれば実態に合わせて更新。

## 検証（必ずやる）

1. **型チェック**：`bunx tsc --noEmit`（exit 0）。`Character` の必須欠け・`appearance` 漏れ・存在しない `talent`/`currentPlaceId` はここで気づける（id 文字列の打ち間違いは型では出ないので目視）。
2. **画像の確認**：`assets/characters/<id>.webp` が生成され、アルファ付き（透過）になっているか。`identify -format '%[channels]\n' assets/characters/<id>.webp` が `srgba` を返せば透過。
3. **登場確認**：`CHARACTER_UNLOCKS` の条件を満たす状況で恒久ロスターに加わり、次周 Day1 から出るか。手早くは `bun run sim` 系で回すか、`localhost:5566` をライブで開いて未解放キャラページ（解放条件の可視化）と突き合わせる（古いスクショを根拠にしない＝CLAUDE.md の鉄則）。

## やりがちな失敗

- **`createInitialCharacters()` に足しただけで `CHARACTER_UNLOCKS` を忘れる** → 定義はあるのに1周目はハルだけなので永遠に登場しない。
- **`appearance` を書かない／日本語で書く** → 絵が崩れる。英語で、既存5体と同粒度で。共通画風はスクリプト側なので二重に書かない。
- **`talent` に新しい異能名を入れる** → engine は既存4値（`insight`/`bond`/`devour`/`none`）しか解釈しない。集霊が無言で素通りする。
- **`currentPlaceId` が places.ts に無い id** → 現在地が解決できず壊れる。新地が要るなら places.ts を先に整える。
- **キャラ絵生成で全体を再生成** → 既存5体まで作り直して無駄な課金。新 id だけ引数で絞る。
- **観客ビューに数値を出す改修をしてしまう** → キャラ追加では基本 UI ロジックは触らない。色（charTheme）と絵だけ。観客ビュー（FrontStage）に数値・意図・囁きを出さない鉄則は維持（CLAUDE.md）。
- `push` はしない。コミット/プッシュはユーザーの指示があってから（その時は push スキルに従う）。
