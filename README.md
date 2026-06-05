# 30日のカウントダウン — LLM 群像シミュレーター

TypeScript + bun の Web アプリ。LLM を使い、毎日（1ティック）複数の妖（あやかし）を京都の霊脈世界で動かして観察する。「観るだけの公開 Web サイト」が最終目的（YouTube 配信は廃止済み）。

> `plan.md` は初期構想（v1）で**内容が古い**ため参照しない。現在の仕様は本ファイルと [`docs/`](docs/README.md) が正。

## クイックスタート

```sh
bun install
bun run dev      # http://localhost:5566（既定: Claude Code バックエンド）
```

### 必要環境

- [bun](https://bun.sh) 1.3+
- **既定（`claude-code`）**: ローカルに [Claude Code](https://claude.com/claude-code) CLI がログイン済みであること
- **`ollama` を使う場合のみ**: `ollama serve` 起動済み＋モデル pull 済み
  ```sh
  ollama pull qwen2.5:7b-instruct
  LLM_BACKEND=ollama bun run dev
  ```

### ローカル開発（トークンを食わない進め方）

`bun run dev` / `bun run start` は起動と同時に自走ワーカーが回り、毎日（1ティック）最大10回 LLM を叩き続ける（配信モデル）。開発中はこれが垂れ流しになるので、**「任意の状態を作る → ワーカー無しでUIを見る → 必要な分だけ進める」** で回す。

```sh
# ① 好きな初期状態で種を作る（mock なら無料 / 実 LLM でもこの一回だけ）
bun run sim --config examples/harsh.json --days 3 --save

# ② 人がUIを見る（自走ワーカー無し＝LLM 呼び出しゼロ。DB の最新 run を表示するだけ）
bun run view            # http://localhost:5566

# ③ もっと見たくなったら、続きから必要な分だけ進める → ② をリロード
bun run sim --resume --days 1 --save
```

- `bun run view` = `WORKER_AUTOSTART=0` で server を起動（自走ワーカーを立てない）。本番 `start` の自走挙動は変わらない。
- `sim --resume` = `data/world.db` の最新 run を復元し、その**続きから** `--days N` だけ進めて同じ run に追記する（既存日数は再計算しない＝実 LLM でも無駄な再課金が出ない）。`--resume` は保存が前提なので `--save` は省略可。
- 数値・UIだけ素早く確認したいときは `--mock`（LLM 不使用）を付ける。詳細は [docs/cli.md](docs/cli.md) / [docs/env.md](docs/env.md)。

## 概要

芯の異なる妖たちが同じ世界に置かれ、出会い・すれ違い・奪い合いが生まれる。1周目はハルだけで始まり、成長に応じて仲間が解放されていく。

- **ハル** — 霊脈の独占を憎む祓いの妖。成長軸=利他。回帰の主人公
- **ナギ** — 見捨てられを恐れる結びの妖。成長軸=自立
- **カイ** — 誰も信じない餓えた半妖。成長軸=信頼
- **ソラ** — どこにも根を下ろさぬ風来の妖。成長軸=信頼
- **シオリ** — 古い約束に縛られた社守りの神使。成長軸=自立

数値の確定（負荷・収支・死亡・段階）は TS コードが保証し、芯と気質からの判断は LLM に委ねる。世界には30日の期限があり、災害は日を追うごとに強まる。30日目の「大禍」に結界が届かなければ回帰して Day1 からやり直す（ローグライク型）。結界はハル独りしか護れないため、初めて大禍を祓い退けた朝は「独りの暁」——仲間は皆散り、隠しスキル「暁の迎え火」を会得してもう一度だけ輪へ戻る。次に祓った朝は迎え火が散った仲間を全員呼び戻し、回帰の輪は断たれて物語は必ず全員生存の絵で完結する（fin・以後世界は進まない）。祓えるようになる条件には「全キャラ解放＋ココロが満ちる」が編み込まれており、物語の完成と fin が必ず一致する。

## ドキュメント

詳細は [`docs/`](docs/README.md) を参照。

| トピック | ドキュメント |
|---|---|
| ディレクトリ構成・技術スタック | [docs/architecture.md](docs/architecture.md) |
| 世界のルール・行動・場所・テンポ | [docs/game-rules.md](docs/game-rules.md) |
| 登場人物・演出家・守護神・ココロ | [docs/characters.md](docs/characters.md) |
| 永続化（Drizzle / SQLite） | [docs/database.md](docs/database.md) |
| API・UI ページ | [docs/api.md](docs/api.md) |
| 環境変数 | [docs/env.md](docs/env.md) |
| LLM バックエンド切替 | [docs/llm-backend.md](docs/llm-backend.md) |
| CLI（`bun run sim`） | [docs/cli.md](docs/cli.md) |
| デプロイ（Railway） | [docs/deploy.md](docs/deploy.md) |
| シークレット検査（gitleaks） | [docs/secrets.md](docs/secrets.md) |
| 画像生成（gpt-image） | [docs/image-gen.md](docs/image-gen.md) |
| RunPod Serverless 調査 | [docs/runpod-serverless.md](docs/runpod-serverless.md) |
