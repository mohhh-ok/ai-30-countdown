# ヘッドレス実行 / CLI

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
| `--director` | 演出家を有効化 |
| `--seed <n>` | 天候の乱数シード（同じ seed なら天候列が再現） |
| `--config <path>` | 初期データ JSON。`characters`/`places` を id 単位で部分上書き、未知 id は新規追加 |
| `--set <path=value>` | 個別上書き（複数可）。例: `haru.params.altruism=90` |
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

## 到達可能性アウディット

会得式スキルやキャラ解放の中に、実質的に到達不能なものが紛れていないかを点検する read-only 診断。世界は進めない。

```sh
bun run scripts/audit-reachability.ts          # 人が読むレポート
bun run scripts/audit-reachability.ts --json   # 機械可読
```

二段で見る:
- **静的**: `measure`/`isUnlocked` を極大文脈でつついて「どの行動でも 0」「全条件マシマシでも false」を検出＝定義バグ
- **動的**: `data/world.db` の実進捗から「通算◯周で progress=0」を検出＝バランス問題。監査ログ `skill_audit`（ワーカーが 1 tick ごとに記録）を使う
