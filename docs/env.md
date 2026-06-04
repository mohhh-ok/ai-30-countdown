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
| `OPENAI_API_KEY` | — | 画像生成（gpt-image）用。`.env` に置けば bun が自動ロード |
