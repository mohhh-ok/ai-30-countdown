# 調査ログ（research）

実 LLM の挙動を「条件を固定して数で観る」ための実験記録を置く。

## decide-samples.jsonl — アクション選択の分布観測（issue #7）

`claude -p` のアクション選択は予測できない。**同じ世界状態を実 LLM に N 回投げ、各キャラがどの
action に寄るかを分布で見る**ための記録（1 実験 = 1 行の JSONL、追記のみ・消えない）。

- 生成元: `scripts/sample-decide.ts`
- mock（`src/llm/mock.ts`）は決定論なので対象外。**実 LLM だけ**を回す。

### 実行例

```bash
bun scripts/sample-decide.ts \
  --purpose "利他70・同室ありで share が出るか" \
  -n 10 \
  --roster haru,nagi \
  --set haru.energy=30 haru.satiety=40 haru.params.altruism=70 \
  --set haru.place=kibune nagi.place=kibune
```

- `--purpose`（必須）: その実験で何を確かめたいか。
- `-n`（既定10）: 同一 state を実 LLM に投げる回数。
- `--roster`（既定: 全キャラ）: 出演させるキャラ id（カンマ区切り）。
- `--set <id>.<path>=<value>`: 世界状態の上書き。`<path>` は `energy` / `satiety` /
  `stealBurden` / `lonelinessSensitivity` / `params.altruism` 等、または `place`（= 場所 id）。
  未知 id・未知フィールド・非数値は throw して止まる（黙って既定化しない）。
- `--mode parallel|combined`（既定: backend 依存）/ `--weather normal|lean`。

### 1 レコードの項目

`datetime`(+09:00) / `commit`(HEAD short) / `backend` / `mode` / `purpose` / `n` /
`weather` / `condition`(固定した主要パラメータ・場所) / `rooms`(同室関係) /
`results`(action→回数) / `errors`(失敗回数) / `rawSamples`(生のサンプル列)。

LLM 応答のパース失敗・不正 action は握りつぶさず **ERROR** として記録・表示し、分布からは除外する。

### 注意

- 実 LLM を N×キャラ数ぶん叩くので時間・枠を消費する。
- `claude -p` 利用時は `ANTHROPIC_API_KEY` を環境に置かない（OAuth サブスク認証で動かす。CLAUDE.md 参照）。
