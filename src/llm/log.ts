// LLM パスの細粒度ログ。stderr にタイムスタンプ付きで出す（サーバ端末でリアルタイムに追える）。
// LLM_LOG=0 で抑制できる（既定は出す）。SQLite 側の発火ログ(llm_calls)とは別系統の「人が読む」ログ。
const ENABLED = process.env.LLM_LOG !== "0";

function ts(): string {
  // HH:MM:SS.mmm（ローカルではなく ISO の時刻部分）
  return new Date().toISOString().slice(11, 23);
}

/** key=value 形式に整える（長い文字列は端折る）。 */
function fmt(extra?: Record<string, unknown>): string {
  if (!extra) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    let s = typeof v === "string" ? v : String(v);
    if (s.length > 120) s = s.slice(0, 117) + "…";
    parts.push(`${k}=${s}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

/** 細粒度ログ1行。scope は "llm" / "onecall" / "claude-cli" など。 */
export function llog(scope: string, msg: string, extra?: Record<string, unknown>): void {
  if (!ENABLED) return;
  console.error(`[${ts()}] [${scope}] ${msg}${fmt(extra)}`);
}
