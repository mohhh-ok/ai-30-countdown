// LLM パスの細粒度ログ。タイムスタンプ付きで出す（サーバ端末でリアルタイムに追える）。
// LLM_LOG=0 で抑制できる（既定は出す）。SQLite 側の発火ログ(llm_calls)とは別系統の「人が読む」ログ。
//
// 出力先は stdout（console.log）。以前は stderr に出していたが、多くのターミナルが
// stderr を赤系で表示するため「通常ログまで全部赤」になっていた。エラー系メッセージ
// （✗ で始まる、または warn フラグ）だけを stderr に回し、通常ログは白で出す。
import { fmtClock } from "../time.ts";

const ENABLED = process.env.LLM_LOG !== "0";

// ANSI カラー（端末以外＝パイプ時は無効化）。NO_COLOR でも無効化。
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s: string) => c("2", s); // 薄字（タイムスタンプ）
const cyan = (s: string) => c("36", s); // scope
const red = (s: string) => c("31", s); // エラー

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
  // ✗ や ⚠ で始まる行だけエラー扱い（stderr＝赤）。それ以外は stdout（白）。
  const isError = /^[✗⚠]/.test(msg);
  // 時計は HH:mm:ss.SSS の固定TZ（Asia/Tokyo）。サーバ端末用なのでブラウザ追従ではなく固定。
  const line = `${dim(`[${fmtClock()}]`)} ${cyan(`[${scope}]`)} ${isError ? red(msg) : msg}${fmt(extra)}`;
  if (isError) console.error(line);
  else console.log(line);
}
