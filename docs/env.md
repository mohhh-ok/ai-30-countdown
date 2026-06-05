# 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PORT` | `5566` | サーバーのポート |
| `LLM_BACKEND` | `claude-code` | LLM バックエンド（`claude-code` / `ollama`）。詳細は [llm-backend.md](llm-backend.md) |
| `CLAUDE_CODE_MODEL` | `haiku` | `claude-code` バックエンドのモデル（`haiku` / `sonnet` / `opus` / 完全ID） |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | `ollama` バックエンドのモデル |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama のホスト |
| `DB_PATH` | `data/world.db` | SQLite データベースのパス |
| `WORKER_INTERVAL_MS` | `1000` | 自走ワーカーの休憩間隔（ミリ秒）。1 tick 完了後に N ms 休んで次へ。**本番は `7200000`（1 tick/2時間）にする**（[deploy.md](deploy.md) の進行ペース方針参照） |
| `LIMIT_BACKOFF_MS` | `900000`（15分） | サブスク使用上限（session/weekly limit 等）で tick を中断・巻き戻した後の追加待機（ミリ秒）。この待機＋通常間隔を置いて同じ日をやり直す（[llm-backend.md](llm-backend.md) の上限時の挙動参照） |
| `WORKER_AUTOSTART` | `1` | サーバー起動時に自走ワーカーを立てるか。`0`/`false` で起動しない＝**UI 閲覧のみ・LLM 呼び出しゼロ**（ローカル開発用）。`bun run view` がこれを使う。本番 `start` は既定どおり起動する |
| `OPENAI_API_KEY` | — | 画像生成（gpt-image）用。`.env` に置けば bun が自動ロード |
