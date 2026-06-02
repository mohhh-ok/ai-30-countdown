# 30日のカウントダウン — LLM 群像シミュレーター

TypeScript + bun の Web アプリ。LLM を使い、毎日（1ティック）複数の妖（あやかし）を京都の霊脈世界で動かして観察する。「YouTube でダラダラ流し続けられる配信エンタメ」が最終目的。

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

## 概要

芯の異なる妖たちが同じ世界に置かれ、出会い・すれ違い・奪い合いが生まれる。1周目はハルだけで始まり、成長に応じて仲間が解放されていく。

- **ハル** — 霊脈の独占を憎む祓いの妖。成長軸=利他。回帰の主人公
- **ナギ** — 見捨てられを恐れる結びの妖。成長軸=自立
- **カイ** — 誰も信じない餓えた半妖。成長軸=信頼
- **ソラ** — どこにも根を下ろさぬ風来の妖。成長軸=信頼
- **シオリ** — 古い約束に縛られた社守りの神使。成長軸=自立

数値の確定（負荷・収支・死亡・段階）は TS コードが保証し、芯と気質からの判断は LLM に委ねる。世界には30日の期限があり、災害は日を追うごとに強まる。30日目の「大禍」を祓い退ければクリア、届かなければ回帰して Day1 からやり直す（ローグライク型）。

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
