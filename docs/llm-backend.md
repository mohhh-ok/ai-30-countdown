# LLM バックエンド切替

LLM 呼び出しは `src/llm/backend.ts` の切替層に集約されており、環境変数 `LLM_BACKEND` で選ぶ。

| `LLM_BACKEND` | 内容 | 既定モデル |
|---|---|---|
| `claude-code`（**既定**） | ローカルの **Claude Code CLI**（`claude -p`）経由。Max サブスクの認証で動く | `haiku`（`CLAUDE_CODE_MODEL` で変更） |
| `ollama` | ローカル **Ollama**（無料・無制限・やや遅い） | `qwen2.5:7b-instruct`（`OLLAMA_MODEL` で変更） |

## Claude Code バックエンド

既定。ローカルに [Claude Code](https://claude.com/claude-code) CLI（`claude`）がインストール・ログイン済みであること。

**課金事故に注意**: `ANTHROPIC_API_KEY` を環境に置かないこと。キーがあると `claude` は OAuth サブスクではなく API キー認証＝従量課金で動く（公式仕様）。`backend.ts` は `claude` へ渡す env からキーを除去しているが、`.env` にも書かないのが安全。

## Ollama バックエンド

```sh
ollama pull qwen2.5:7b-instruct
LLM_BACKEND=ollama bun run dev
```

軽量モデルへの切替例:
```sh
LLM_BACKEND=ollama OLLAMA_MODEL=qwen2.5:3b-instruct bun run dev
```

## 本番での方針

本番（公開運用）でも **`claude -p`（Claude Code CLI）をそのまま使う**。Max サブスクの認証で動くため、追加の API 課金は発生しない。自前ホスティングの過去の検討メモは [runpod-serverless.md](runpod-serverless.md) を参照（未採用）。
