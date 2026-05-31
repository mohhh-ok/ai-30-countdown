# 小さなエージェント世界 — TS + bun + ローカルLLM

`plan.md`（2人・テキスト版 v1 仕様書）を、TypeScript + bun の Web アプリとして実装し、**数人（群像）**に拡張したもの。
ローカルの LLM を使い、毎日（1ティック）複数のキャラクターを動かして観察する。

## LLM バックエンド

LLM 呼び出しは `src/llm/backend.ts` の切替層に集約されており、環境変数 `LLM_BACKEND` で選ぶ。

| `LLM_BACKEND` | 内容 | 既定モデル |
|---|---|---|
| `claude-code`（**既定**） | ローカルの **Claude Code CLI**（`claude -p`）経由。Max サブスクの認証で動く | `haiku`（`CLAUDE_CODE_MODEL` で変更） |
| `ollama` | ローカル **Ollama**（無料・無制限・やや遅い） | `qwen2.5:7b-instruct`（`OLLAMA_MODEL` で変更） |

> 既定は **Claude Code（`claude -p`）**。Ollama を使うときだけ `LLM_BACKEND=ollama` を指定する。

## 仕組み

- **決定論パート（TSコード）**: 負荷 −8 / エネルギー収支 / パラメータの 0–100 クランプ・±5上限 / 死亡判定 / 段階しきい値 / 天候抽選 / 記憶管理 / 移動の妥当性。
- **LLMパート**: 気質と記憶を踏まえた行動選択・移動先・パラメータ変動の提案・一行日記・関係ラベルを構造化JSONで返す。

数値はTSが保証し、芯と気質からの判断はLLMに委ねる役割分担。

## 登場人物（群像）

芯の異なる3人が同じ世界に置かれ、出会い・すれ違い・奪い合いが生まれる。

- **ハル** — 資源の独占を憎む、冷静で口数少ない一匹狼。成長軸=利他。貴船の渓から。
- **ナギ** — 見捨てられることを恐れる、明るく世話焼き。成長軸=自立。鴨川の河原から。
- **カイ** — 生き延びるためなら奪う、誰も信じない危険な者（奪う・生存本能）。成長軸=信頼。伏見の稲荷から。物語の触媒。

対人行動（語りかける／分け与える／奪う／欺く）は同じ場所にいる相手に向けて行う。同室に複数いるときは誰に向けるかを選ぶ。

## キャラの内部モデル

各キャラは性格（長期）と気分（短期）の2層を持つ。

- **成長パラメータ（性格・長期）**: 利他／自立／信頼（0–100）。経験の結果としてのみ ±1〜5 で動く。芯は不変。
- **エネルギー執着度 `satiety`**: 充足とみなすエネルギー水準。高いほど執着型（ハル=55 / カイ=50）、低いほど「ある程度あれば他に興味」型（ナギ=28）。
- **報酬・抗体システム（気分・短期）**: 行動の結果＝イベントに報酬を出す（採取＝達成、語りかけ噛み合い／分け与え＝絆、休息／満腹＝安らぎ、奪う／欺く＝背徳）。
  - **抗体方式**: `実効報酬 = 基礎 ×(1 − 抗体/100)`。報酬を得るほど抗体が増えて鈍り（飽き）、やめれば減衰して戻る。
  - **抗体は個体差**（チャネル別の感作率＋減衰率）。ハルは達成に飽きにくい執着型、ナギは絆に飽きず一人の達成にすぐ飽きる。
  - **気分**: 高揚（達成+背徳）／温かさ（絆）／安らぎ／ストレス。ストレス（飢え・拒絶・被害）は抗体がつかず蓄積。
  - 気分と「飽き具合」を言葉に翻訳してプロンプトに渡す＝報酬を行動に結びつける。

## 演出家（ディレクター）

物語がエンタメとして面白くなるよう、**環境にだけ**介入する LLM 演出家（任意）。キャラの芯・行動・自由意志には触れない。

- 毎日の幕開けに**緊張度**（calm／stagnant／tense／tragic）を読み、**天候の決定・場所の実りの一時操作・幕開けナレーション**を行う。
- 例: 膠着（stagnant）を検知すると不作で揺さぶる、悲劇直前（tragic）には猶予を与えて見せ場を作る。「2人が離れたまま出会わない」状態も膠着として検知する。
- Web では常に有効。CLI では `--director` で有効化。

### 守護神と衝動

演出家はキャラの行動を直接操作できないので、**守護神**を介して働きかける（`--director` で同時に有効化）。

- 演出家は「この者をどう動かしたいか」を `directives` で守護神に指示する。
- **守護神**は各キャラに憑き、その指示を**芯と気分に根ざした一人称の囁き**に変換。囁きは行動決定プロンプトに「ふと心に浮かんだ声（従っても抗ってもよい）」として注入される。
- **衝動**: 囁きを受けても従わない日が募る（`whisperIgnored` が閾値超）と、「抑えきれない衝動」が発火し、より孤独に弱い側が相手の方へ動き出す（両者同時移動のすれ違いを防ぐため1人だけ）。小型モデルが囁きを行動に翻訳できないときの保険。

これにより `環境（演出家）→ 囁き（守護神）→ 募って衝動 → 出会い → 会話 → 関係の機微` の連鎖で、膠着を確実に解いてドラマを生む。

### カメラ（主役・スポットライト）

裏では全員を等しくシミュレートしつつ、観客が追うのは「いま最も物語が動いている一人」の視点。演出家が毎日**主役（spotlight）**を選ぶ。

- 演出家は葛藤・危機・決断・出会い・裏切りが宿る人物にカメラを向け、漫然と同じ視点を続けて飽きさせない。
- 主役が力尽きて退場したら、カメラは残った者の中で最も目が離せない者へ移る。だから物語は途切れず続く（ダラダラ配信に向く）。
- 演出家が未指定/無効のときは、エンジンがその日の「見せ場の大きさ」（死・段階変化・移動・衝動・対人・強い感情・大きなエネルギー変動）が最大の生存者を自動で主役にする。
- Web では主役カードが強調表示され、ログに `🎥 今日の主役` が出る。CLI でも `🎥 主役` 行が出る。

## 場所（舞台＝京都）

京都の実在地名を場所として持ち、キャラは「移動する」で隣の場所へ1日かけて移動できる。

| 場所 | 特徴 | 採取（通常/不作） |
|---|---|---|
| 鴨川の河原 | 街なかの水辺・ハブ | 12 / 5 |
| 大原の里 | 豊かな里・畑 | 16 / 7 |
| 貴船の渓 | 山奥・安定だが控えめ | 9 / 7 |
| 嵐山の竹林 | 西郊・やや多め | 14 / 5 |
| 伏見の稲荷 | 実り大だが不作に弱い博打 | 18 / 1 |

- 「分け与える」「語りかける」「奪う」「欺く」は**相手と同じ場所にいるときだけ**できる。離れていれば移動して近づく必要がある。
- 初期配置: ハルは人里離れた **貴船の渓**、ナギは人の気配のある **鴨川の河原**、カイは博打の地 **伏見の稲荷**（芯に沿った配置）。
- 移動した日は採取できないトレードオフがあり、「採取一辺倒」を崩す効きがある。

## 会話劇（talk 成立時・1シーン化）

「語りかける」が成立した日（相手と同じ場所にいるとき）だけ、その2人の**会話劇**を生成する。
一括ではなく**一発言ずつ**生成し、話し手を交互に交代させながら往復ループで一場面を組み立てる（最小2・最大8発言、LLM が締めどころと判断したら打ち切り）。各ターンは直前までの応酬を見て応えるので、噛み合った会話になる（ナギが話しかけ、採取で忙しいハルがそっけなく返す等）。結果は `dialogue` として保存・表示し、`dialogues` テーブルにも残る。

## 時間モデル（シーン駆動・可変テンポ）

「流しっぱなしで観られる配信エンタメ」を狙い、その日の**見せ方の密度**を「いま面白いか」で切り替える。各 `TickResult` は `tempo`（`montage` / `scene`）と `tempoReasons` を持つ。

- **montage（早回し）**: 離れている・単調な日。1行ステータスだけ淡々と流す（霊力の増減は見えるので生存のヒリつきは残る）。
- **scene（カメラ寄り）**: 「面白い瞬間」をフル展開する。昇格条件は **出会い・会話劇・餓死寸前（霊力 ≤ 12）・禁忌・段階変化・衝動・死**。
- CLI は montage 日を `·`、scene 日を `🎬`（＋見せ場の理由）で出し分ける。Web の表ビューは montage を1行、scene を場面カードとして描く。

## ヘッドレス実行 / テスト（CLI）

サーバーを立てずに、パラメータ・初期データを渡して N 日を一気に回せる。

```sh
bun run sim --help                                  # オプション一覧
bun run sim --days 8 --mock                          # LLM不要・一瞬で8日
bun run sim --days 10 --seed 42                      # 天候を再現可能に
bun run sim --config examples/harsh.json --mock      # 初期データをファイルで上書き
bun run sim --set haru.energy=40 --set places.kibune.forage.normal=3 --mock
bun run sim --days 3 --set nagi.currentPlaceId=kibune # 2人を同居させ会話を誘発
bun run sim --days 8 --mock --json                   # 結果を JSON で出力
bun run sim --days 6 --save                          # 結果を SQLite にも保存
```

| オプション | 説明 |
|---|---|
| `--days <n>` | 進める日数（default 8） |
| `--mock` | LLM を使わず簡易ロジックで高速実行（数値・移動・死亡・会話配線の検証用） |
| `--director` | 演出家を有効化（環境に介入してドラマを作る） |
| `--seed <n>` | 天候の乱数シード（同じ seed なら天候列が再現） |
| `--config <path>` | 初期データ JSON。`characters`/`places` を id 単位で部分上書き、未知 id は新規追加。`days`/`seed` も指定可 |
| `--set <path=value>` | 個別上書き（複数可）。例: `haru.params.altruism=90`, `places.ohara.forage.normal=0` |
| `--save` | 結果を `data/world.db` にも保存 |
| `--no-dialogue` | 会話生成オフ（速度優先） |
| `--json` | 結果を JSON で標準出力 |

初期データ JSON の例（`examples/harsh.json`）:
```json
{
  "days": 10,
  "seed": 7,
  "characters": {
    "haru": { "energy": 45 },
    "nagi": { "energy": 45, "currentPlaceId": "ohara" }
  },
  "places": { "kibune": { "forage": { "normal": 4, "lean": 2 } } }
}
```

## オートモード

ヘッダの **「▶▶ オート」** で、1日ずつ自動で進み続ける（各ティックのLLM応答完了を待って次へ）。「⏸ 停止」で止まり、世界が終了したら自動停止する。

## 必要環境

- [bun](https://bun.sh) 1.3+
- **既定（`claude-code`）**: ローカルに [Claude Code](https://claude.com/claude-code) CLI（`claude`）があり、ログイン済み（Max サブスク等）であること。
- **`ollama` バックエンドを使う場合のみ**: [Ollama](https://ollama.com) が起動していること（`ollama serve`）＋モデルを pull 済み
  ```sh
  ollama pull qwen2.5:7b-instruct
  ```

## 起動

```sh
bun install
bun run dev                          # http://localhost:5566（既定: Claude Code バックエンド）
LLM_BACKEND=ollama bun run dev       # Ollama を使う場合
```

ブラウザで開き、「次の1日 ▶」で1日ずつ進める。「リセット」で初期化。

## シークレット検査（gitleaks）

API キー等の漏洩を防ぐため [gitleaks](https://github.com/gitleaks/gitleaks) を使う。pre-commit でステージ済み差分を検査し、検出時はコミットを中止する。

- フック実体は `.githooks/pre-commit`（リポジトリ管理下）。`core.hooksPath` での有効化はローカル設定なので、**クローン直後に1回だけ**実行する:
  ```sh
  brew install gitleaks                 # 未インストールなら
  git config core.hooksPath .githooks   # フック有効化（クローンごとに1回）
  ```
  Windows 等で実行権限が落ちた場合は `chmod +x .githooks/pre-commit` も実行する。
- 手動スキャン:
  ```sh
  bun run secrets          # 全履歴をスキャン
  bun run secrets:staged   # ステージ済み差分のみ
  ```
- 誤検知は該当行末に `gitleaks:allow` を付けるか `.gitleaks.toml` で除外する。
- **CI**: `.github/workflows/gitleaks.yml` が push / PR で全履歴を再スキャンする（手元のフックをすり抜けても CI で検出）。

## 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PORT` | `5566` | サーバーのポート |
| `LLM_BACKEND` | `claude-code` | LLM バックエンド（`claude-code` / `ollama`） |
| `CLAUDE_CODE_MODEL` | `haiku` | `claude-code` バックエンドのモデル（`haiku` / `sonnet` / `opus` / 完全ID） |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | `ollama` バックエンドのモデル（例: `qwen2.5:3b-instruct`） |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama のホスト |
| `DB_PATH` | `data/world.db` | SQLite データベースのパス |

## 永続化（SQLite）

`bun:sqlite`（依存ゼロ）で `data/world.db` に保存する。サーバーを再起動すると最新 run の続きから復元される。

- `runs` — 1回のシミュレーション（リセットごとに新 run）。現在の state スナップショットを持つ。
- `ticks` — 各日の結果（`TickResult`）を丸ごと JSON 保存。表示・復元用。
- `char_metrics` — 1日×1人を正規化した薄い行。成長曲線や行動頻度の SQL 集計用。

集計例:
```sh
# ナギの自立心の推移
sqlite3 data/world.db "SELECT day, independence FROM char_metrics WHERE char_id='nagi' ORDER BY day;"
# 行動の頻度
sqlite3 data/world.db "SELECT name, action, COUNT(*) FROM char_metrics GROUP BY char_id, action;"
```

```sh
LLM_BACKEND=ollama OLLAMA_MODEL=qwen2.5:3b-instruct bun run dev   # Ollama の軽量モデルに切替
```

## API

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/state` | 現在の世界状態とログ |
| GET | `/api/health` | バックエンド疎通とモデル名 |
| POST | `/api/tick` | 1日進める |
| POST | `/api/reset` | 初期化 |

## 構成

```
src/
  domain/     世界モデルとルール（types/characters/rules/engine）
  llm/        LLM バックエンド切替（backend.ts）・各 provider・プロンプト・判断検証
  server.ts   Bun.serve（API + フロント配信）
  web/        React UI
```
