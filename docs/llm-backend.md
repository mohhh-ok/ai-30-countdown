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

本番（公開運用）でも **`claude -p`（Claude Code CLI）をそのまま使う**。Max サブスクの認証で動く。
（2026-06-15 以降、`claude -p` はサブスクでも月次の Agent SDK credit 消費になる——CLAUDE.md「LLM 呼び出し方針」参照。）
自前ホスティングの過去の検討メモは [runpod-serverless.md](runpod-serverless.md) を参照（未採用）。

## 使用上限（session/weekly limit）に当たったときの挙動

サブスク運用ではセッション/週次の使用上限に当たりうる。このとき**フォールバックの既定行動で
偽の1日を演じて DB に残すのではなく、その tick を安全に中断する**（2026-06 合意）:

- `backend.ts` が claude の失敗出力から上限系メッセージ（"You've hit your session limit" 等）を
  判定し、型付きの `UsageLimitError`（`src/domain/types.ts`）を投げる。
- 各プロバイダ（decide / director+guardian / dialogue / onecall）は通常の失敗ならリトライ→
  フォールバックするが、**`UsageLimitError` だけは握りつぶさず再 throw** して tick ごと中断させる。
- `runTick` は world を破壊的更新するため、中断時はメモリ上の世界が半端に進んで汚れている。
  `server.ts` のワーカーがこれを捕まえ、**DB の最終スナップショットから `Campaign.restore` で
  巻き戻す**（saveTick/saveRunState は未実行なので DB は無傷）。その後 `LIMIT_BACKOFF_MS`
  （既定15分）＋通常間隔を置いて**同じ日をやり直す**。ワーカー自体は止まらない。
- CLI（`bun run sim`）では `UsageLimitError` は捕捉されずプロセスが落ちる。保存済みの日までが
  DB に残るので、上限回復後に `sim --resume` で続きから再開すればよい。
- 注意: session/weekly limit の文言は公式エラーリファレンスで確認済みだが、**Agent SDK credit
  枯渇（2026-06-15 開始）の実文言は未確認**。credit 系は見当で広めに拾っているため、実際に
  枯渇を観測したら `backend.ts` の `isUsageLimitMessage` の正規表現を実文言で更新すること。
