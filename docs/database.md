# 永続化（SQLite / Drizzle ORM）

## 概要

**Drizzle ORM**（`drizzle-orm` の bun-sqlite ドライバ）で `data/world.db` に保存する。サーバーを再起動すると最新 run の続きから復元される。

- スキーマの正: `src/schema.ts`（Drizzle テーブル定義）
- 読み書き: `src/db.ts`（全て drizzle 経由。生SQL/prepared statement・手書き `CREATE TABLE`/`ALTER` は廃止）

## スキーマ管理（drizzle-kit push）

テーブルの実体化は `bun run db:push`（= `drizzle-kit push --force`）で行う。`dev`/`start`/`sim` の起動時にも自動で走る（先頭で push してから本体を起動）。

列を足すときは `src/schema.ts` を編集して `bun run db:push` するだけ（手書きの `ALTER` は不要）。

| スクリプト | 役割 |
|---|---|
| `bun run db:push` | `src/schema.ts` を DB に反映（`--force`＝データロス自動承認） |
| `bun run db:generate` | 将来バージョン管理されたマイグレーションが要るとき用（現状は push 運用） |
| `bun run db:studio` | Drizzle Studio で DB を閲覧 |

## テーブル一覧

### `runs` — 年代記（回帰をまたぐ1セッション）
年代記スカラー（周回・日・天候・主人公・ハルのピーク利他等）を列に持つ。復元用スナップショット。CLI（`sim`）も Web（`server`）も同じテーブルに保存する。

### `run_skill` — スキル進捗
1スキル1行。`acquired`（会得済み）/ `progress`（進捗カウンタ）。

### `run_roster` — 恒久ロスター
解放済みキャラ。1キャラ1行。

### `run_char` — キャラの可変状態
周の途中から再開するためのもの。霊力・成長値・気分・抗体・囁き・関係・記憶・ココロ（`soulCountersJson`）・荒ぶり（`frenzyJson`・半妖カイのみ）等を持つ。不変設定はコードが正。1キャラ1行で上書き。

### `run_place` — 場所の可変状態
民の霊力の枯れ具合（`sei`/`daku`）だけ。地形・隣接・上限はコードが正。1場所1行で上書き。

### `run_event` — 環境イベント
いま京に起きている災い/恵み（回帰でリセット）。保存のたびに全消し→入れ直し。

### `run_loop_summary` — 過去の周回の結末
年代記 history。1周1行。クリア/未クリア・到達段階・会得スキル・メタハイライトを記録。
結末は日本語の `cause_of_end`（source of truth）に加え、表示の多言語化用に構造化（`end_kind`＝`cleared`（クリア）/`died`（力尽き）/`solo_dawn`（大禍は祓ったが独りの暁）、`end_place_id`＝力尽きた場所 id）を持つ。旧 run（未設定）は日本語へフォールバック。

### `ticks` — 日次結果
各日の `TickResult` を1日1行で JSON 保存（`loop`/`day` で識別。回帰で `day` は周ごとに1に戻る）。表示ログはここから組む。

### `char_metrics` — キャラ指標（正規化）
1日×1人を正規化した薄い行。成長曲線や行動頻度の SQL 集計用。

### `dialogues` — 会話行
その日の会話を1発言1行で保存。`seq` で発言順を保持。

### `llm_timings` — LLM 呼び出し計時
LLM 呼び出し1回ぶんの所要時間。ボトルネック分析用。ラベル（`decide:haru` / `dialogue` / `director` / `guardian`）で種別を区別。

### `llm_calls` — LLM 発火ログ
叩いた瞬間に1行（`status='started'`）を残し、完了時に更新。進行中の呼び出しを可視化する。

### `skill_audit` — 到達可能性監査ログ
毎 tick 1行。ハルの利他・ピーク利他・習得済みスキル・全スキル進捗・解放済みキャラを時系列で記録。`scripts/audit-reachability.ts` が使う。

## 集計例

```sh
# ナギの自立心の推移
sqlite3 data/world.db "SELECT day, independence FROM char_metrics WHERE char_id='nagi' ORDER BY day;"

# 行動の頻度
sqlite3 data/world.db "SELECT name, action, COUNT(*) FROM char_metrics GROUP BY char_id, action;"
```

## 永続化の配線チェックリスト

列を足すときに忘れず全部通す:

1. `src/schema.ts` に列追加
2. `src/db.ts` の `charSaveToRow`（insert 値）
3. `loadLatestRun` の select マッピング
4. `CharSave`（`campaign.ts`）
5. save/restore マッピング

どれか欠けると silently 保存漏れになる。
