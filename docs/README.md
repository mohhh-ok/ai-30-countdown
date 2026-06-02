# ドキュメント目次

> 仕様の正はこの `docs/` ディレクトリとルートの `README.md`。`plan.md` は初期構想（v1）で内容が古いため参照しない。

## 設計・仕様

| ドキュメント | 内容 |
|---|---|
| [architecture.md](architecture.md) | ディレクトリ構成・技術スタック・スタイリング方針 |
| [game-rules.md](game-rules.md) | 世界のルール（30日カウントダウン・行動・場所・天候・災害・テンポ） |
| [characters.md](characters.md) | 登場人物・内部モデル・ココロ・演出家・守護神・カメラ |
| [database.md](database.md) | 永続化（Drizzle ORM / SQLite）・テーブル一覧・集計例 |
| [api.md](api.md) | API エンドポイント・UI ページ一覧 |
| [env.md](env.md) | 環境変数一覧 |
| [llm-backend.md](llm-backend.md) | LLM バックエンド切替（Claude Code CLI / Ollama） |

## 運用

| ドキュメント | 内容 |
|---|---|
| [cli.md](cli.md) | ヘッドレス実行（`bun run sim`）・到達可能性アウディット |
| [deploy.md](deploy.md) | デプロイ方針（Railway）・公開時の制約 |
| [secrets.md](secrets.md) | シークレット検査（gitleaks / pre-commit） |

## 画像・素材

| ドキュメント | 内容 |
|---|---|
| [image-gen.md](image-gen.md) | キャラ絵・場所絵・タイトルロゴの生成（OpenAI gpt-image） |

## 調査・アイデア

| ドキュメント | 内容 |
|---|---|
| [research/README.md](research/README.md) | 実 LLM の挙動を数で観る実験ログ（アクション選択の分布観測 ほか） |
| [runpod-serverless.md](runpod-serverless.md) | RunPod Serverless 調査メモ（本番 LLM ホスティング候補） |
| [ideas.md](ideas.md) | 将来アイデア・バックログ |
