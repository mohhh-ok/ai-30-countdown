// LLM backend の切替層。すべての provider はここの chatJSON を使う。
//   LLM_BACKEND=claude-code （既定）… ローカルの Claude Code CLI（`claude -p`）経由。
//                                     Max サブスクの認証で動き、--model でモデル指定（既定 haiku）。
//   LLM_BACKEND=ollama          … ローカル Ollama（無料・無制限・やや遅い）。
import {
  chatJSON as ollamaChatJSON,
  ping as ollamaPing,
  OLLAMA_MODEL,
  type ChatMessage,
} from "./ollama.ts";
import { recordTiming } from "./timing.ts";
import { llog } from "./log.ts";
import { logLlmCallStart, logLlmCallEnd } from "../db.ts";

export type { ChatMessage } from "./ollama.ts";

export const BACKEND = (process.env.LLM_BACKEND ?? "claude-code").toLowerCase();
/** claude-code のモデル（haiku / sonnet / opus / 完全ID） */
export const CLAUDE_CODE_MODEL = process.env.CLAUDE_CODE_MODEL ?? "haiku";

/** 表示・記録用のバックエンド名とモデル名 */
export const BACKEND_NAME = BACKEND === "ollama" ? "ollama" : "claude-code";
export const MODEL = BACKEND === "ollama" ? OLLAMA_MODEL : CLAUDE_CODE_MODEL;

/** ```json …``` フェンスや前後の地の文を剥がして、最初の JSON オブジェクトだけ取り出す */
function stripToJson(s: string): string {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  // 一部モデルは "delta": +5 のように数値先頭に + を付ける（JSON不正）。除去する。
  t = t.replace(/([:\[,]\s*)\+(\d)/g, "$1$2");
  return t;
}

/**
 * Claude Code CLI（`claude -p`）を1ショットで呼ぶ。
 * - --system-prompt で Claude Code 既定のエージェント系プロンプトを置き換え（ガワ税の圧縮＋素直な生成）
 * - --strict-mcp-config + 空 MCP 設定で MCP ツール群を読み込ませない（オーバーヘッド削減）
 * - --output-format json で {result: "..."} を受け、result から JSON を抽出
 */
async function claudeCodeChatJSON(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; agentic?: boolean } = {},
): Promise<string> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n");
  const model = opts.model ?? CLAUDE_CODE_MODEL;

  // 通常は全ツールを殺して「生成専用」にする（足場トークン削減）。
  // agentic のときだけ Task を解禁し、このプロセス内でサブエージェントを fan-out できるようにする
  //   （onecall: 1プロセス起動で director/各キャラ判断/会話を並列に分担 → クリーンな個別文脈）。
  const args = [
    "-p",
    user,
    "--output-format",
    "json",
    "--model",
    model,
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--allowedTools",
    opts.agentic ? "Task" : "",
  ];
  if (!opts.agentic) {
    args.push(
      "--disallowedTools",
      "Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit",
    );
  }
  if (system) args.push("--system-prompt", system);

  const t0 = performance.now();
  llog("claude-cli", "spawn", {
    model,
    agentic: opts.agentic ? "yes" : "no",
    promptChars: user.length,
    sysChars: system.length,
  });
  const proc = Bun.spawn(["claude", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // テレメトリ・自動更新・非必須モデル呼び出しを止めて、起動を軽く・静かにする
    env: {
      ...process.env,
      // ★課金事故の再発防止（過去にこれで従量課金が出た）:
      //   ANTHROPIC_API_KEY が環境にあると claude はサブスク(OAuth)ではなく
      //   その API キー認証＝従量課金で動く（公式仕様・実機で確認済み）。
      //   ここで明示的に除去し、claude -p を必ず Max サブスク枠で走らせる。
      //   キー無しなら OAuth サブスク認証となり、枠内なら追加課金は出ない。
      //   API キー認証に倒しうる変数を網羅して除去する（AWS/Foundry 含む）。
      //   ※ CLAUDE_CODE_OAUTH_TOKEN はサブスク側なので除去しない（消すと逆効果）。
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      ANTHROPIC_AWS_API_KEY: undefined,
      ANTHROPIC_FOUNDRY_API_KEY: undefined,
      // 非必須の外部通信（テレメトリ/エラー報告/自動更新等）を一括停止。
      // これを切らないと毎回ネットワークのタイムアウト待ちで数〜十数秒遅くなる。
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
      DISABLE_BUG_COMMAND: "1",
      CLAUDE_CODE_ENABLE_TELEMETRY: "0",
    },
  });
  // stdout/stderr を必ず「並行で」読み切る。片方しか読まないとパイプバッファが詰まり、
  // 子プロセスが書き込みでブロックして proc.exited が返らなくなる（デッドロック）。
  const tSpawned = performance.now();
  const [stdout, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text().catch(() => ""),
  ]);
  const tOut = performance.now(); // 出力を読み切った時刻
  const code = await proc.exited;
  const wallMs = Math.round(performance.now() - t0);

  // 外側は Claude Code の result JSON。claude 自身が報告する所要時間も取り出して、
  //   wall（こちらの計測）との差で「待ちがどこで生じたか」を切り分ける:
  //   - apiMs ≈ wallMs        → モデル/API 側で時間がかかっている（スロットリング等）
  //   - apiMs ≪ wallMs        → bun 側のプロセス起動/出力読み取りの待ち（イベントループ詰まり等）
  let content = "";
  let apiMs: number | undefined;
  let claudeMs: number | undefined;
  let numTurns: number | undefined; // 親が回したエージェントターン数（agentic の多ターン代償の指標）
  let isError = false;
  try {
    const outer = JSON.parse(stdout) as {
      result?: string;
      is_error?: boolean;
      duration_api_ms?: number;
      duration_ms?: number;
      num_turns?: number;
    };
    content = outer.result ?? "";
    apiMs = outer.duration_api_ms;
    claudeMs = outer.duration_ms;
    numTurns = outer.num_turns;
    isError = !!outer.is_error;
  } catch {
    content = stdout;
  }

  llog("claude-cli", "exit", {
    code,
    wallMs,
    apiMs,
    claudeMs,
    turns: numTurns,
    overheadMs: claudeMs !== undefined ? wallMs - claudeMs : undefined,
    readMs: Math.round(tOut - tSpawned),
    outBytes: stdout.length,
  });

  if (code !== 0) {
    llog("claude-cli", "nonzero-exit", { code, stderr: stderrText.slice(0, 200) });
    throw new Error(`claude -p exited ${code}: ${stderrText.slice(0, 300)}`);
  }

  if (isError || !content) {
    throw new Error(`claude -p returned no result: ${stdout.slice(0, 300)}`);
  }
  return stripToJson(content);
}

/**
 * バックエンドに応じた JSON チャット。失敗時は例外（呼び出し側でリトライ/フォールバック）。
 * opts.label に呼び出しの種別/対象（例 "decide:haru"）を渡すと、所要時間が timing シンクに記録される。
 * 計測は成功・失敗どちらも1件として記録する（失敗してリトライした試行も可視化される）。
 */
export async function chatJSON(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; label?: string; agentic?: boolean } = {},
): Promise<string> {
  const t0 = performance.now();
  const label = opts.label ?? "llm";
  const model = opts.model ?? MODEL;
  // 「叩いた」瞬間に記録（コンソール＋SQLite llm_calls。status='started' で1行）。
  llog("llm", "→fire", { label, backend: BACKEND_NAME, model, agentic: opts.agentic ? "yes" : "no" });
  const callId = logLlmCallStart(label, BACKEND_NAME, model, opts.agentic);
  try {
    const out =
      BACKEND === "ollama"
        ? await ollamaChatJSON(messages, opts)
        : await claudeCodeChatJSON(messages, opts);
    const ms = Math.round(performance.now() - t0);
    recordTiming({ label, backend: BACKEND_NAME, model, ms, ok: true, chars: out.length });
    llog("llm", "✓done", { label, ms, chars: out.length });
    logLlmCallEnd(callId, "ok", ms, out.length);
    return out;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const emsg = err instanceof Error ? err.message : String(err);
    recordTiming({ label, backend: BACKEND_NAME, model, ms, ok: false, chars: 0 });
    llog("llm", "✗error", { label, ms, err: emsg });
    logLlmCallEnd(callId, "error", ms, 0, emsg);
    throw err;
  }
}

/** バックエンド疎通確認 */
export async function ping(): Promise<boolean> {
  if (BACKEND === "ollama") return ollamaPing();
  try {
    const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}
