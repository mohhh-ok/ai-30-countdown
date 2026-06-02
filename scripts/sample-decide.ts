// 「条件固定 × 繰り返しサンプリング」で、実 LLM のアクション選択の傾向を分布で観測する。
// （issue #7。mock のルールベースは決定論なので対象外。実 LLM だけを回す。）
//
// 使い方:
//   bun scripts/sample-decide.ts \
//     --purpose "利他70・同室ありで share が出るか" \
//     -n 10 \
//     --roster haru,nagi \
//     --set haru.energy=30 haru.satiety=40 haru.params.altruism=70 \
//     --set haru.place=kibune nagi.place=kibune \
//     [--mode parallel|combined] [--weather normal|lean]
//
//   --set <id>.<path>=<value> を好きなだけ並べて世界状態を上書きする。
//     <path> 例: energy / satiety / stealBurden / lonelinessSensitivity /
//                params.altruism / params.independence / params.trust /
//                place（= currentPlaceId。場所 id を渡す）
//
// 同一 state に対し decide を N 回（既定10）叩き、キャラごとの action 分布を出す。
// 1 実験 = 1 レコードを docs/research/decide-samples.jsonl に追記保存する（消えない記録）。
//
// 注意（CLAUDE.md 方針）:
//   - パース失敗・不正 action は握りつぶさず「失敗(ERROR)」として可視化・記録する（フォールバック禁止）。
//   - claude -p 利用時は ANTHROPIC_API_KEY を環境に置かない（OAuth サブスク認証で動かす）。
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { createChronicle, freshWorldFor } from "../src/domain/campaign.ts";
import { createInitialCharacters } from "../src/domain/characters.ts";
import { ACTIONS } from "../src/domain/types.ts";
import type { Action, Character, WorldState, Weather } from "../src/domain/types.ts";
import { BACKEND, BACKEND_NAME, MODEL, chatJSON } from "../src/llm/backend.ts";
import { SYSTEM_PROMPT, buildSingleUserPrompt, buildUserPrompt } from "../src/llm/prompt.ts";

const OUT_PATH = "docs/research/decide-samples.jsonl";

// ---- 引数パース --------------------------------------------------------------
interface Args {
  purpose: string;
  n: number;
  roster: string[] | null; // null = 全キャラ
  mode: "parallel" | "combined" | null; // null = backend 既定
  weather: Weather;
  sets: string[]; // "id.path=value" の羅列
}

function parseArgs(argv: string[]): Args {
  const a: Args = { purpose: "", n: 10, roster: null, mode: null, weather: "normal", sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${t} に値がありません`);
      return v;
    };
    if (t === "--purpose") a.purpose = next();
    else if (t === "-n" || t === "--n") a.n = Number(next());
    else if (t === "--roster") a.roster = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (t === "--mode") {
      const m = next();
      if (m !== "parallel" && m !== "combined") throw new Error(`--mode は parallel|combined: ${m}`);
      a.mode = m;
    } else if (t === "--weather") {
      const w = next();
      if (w !== "normal" && w !== "lean") throw new Error(`--weather は normal|lean: ${w}`);
      a.weather = w;
    } else if (t === "--set") {
      // 後続の "x=y" トークンを吸う（フラグ "--..." は飲み込まない＝誤引数を黙殺しない）
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--") && argv[i + 1].includes("=")) {
        a.sets.push(argv[++i]);
      }
    } else if (!t.startsWith("--") && t.includes("=")) {
      a.sets.push(t); // --set 無しでも素の x=y を受ける（フラグ形 --foo=bar は弾く）
    } else throw new Error(`不明な引数: ${t}`);
  }
  if (!a.purpose) throw new Error("--purpose は必須です（この実験で何を確かめたいか）");
  if (!Number.isInteger(a.n) || a.n < 1) throw new Error(`-n は1以上の整数: ${a.n}`);
  return a;
}

// ---- 条件の上書き ------------------------------------------------------------
/** "id.path=value" を1件、state に適用する。未知 id / 未知フィールド / 非数値は throw（握りつぶさない）。 */
function applySet(state: WorldState, assign: string) {
  const eq = assign.indexOf("=");
  if (eq < 0) throw new Error(`--set は "id.path=value" 形式: ${assign}`);
  const lhs = assign.slice(0, eq);
  const rhs = assign.slice(eq + 1);
  const parts = lhs.split(".");
  const id = parts[0];
  const char = state.characters.find((c) => c.id === id);
  if (!char) {
    const ids = state.characters.map((c) => c.id).join(", ");
    throw new Error(`未知のキャラ id: ${id}（ロスター: ${ids}）`);
  }
  const path = parts.slice(1);
  if (path.length === 1 && path[0] === "place") {
    if (!state.places.some((p) => p.id === rhs)) {
      throw new Error(`未知の場所 id: ${rhs}（${state.places.map((p) => p.id).join(", ")}）`);
    }
    char.currentPlaceId = rhs;
    return;
  }
  const num = Number(rhs);
  if (!Number.isFinite(num)) throw new Error(`数値でない値: ${lhs}=${rhs}`);
  // 既存の数値フィールドだけ書き換える（typo で別物を生やさない）
  let obj: Record<string, unknown> = char as unknown as Record<string, unknown>;
  for (let k = 0; k < path.length - 1; k++) {
    const nx = obj[path[k]];
    if (!nx || typeof nx !== "object") throw new Error(`未知のフィールド経路: ${lhs}`);
    obj = nx as Record<string, unknown>;
  }
  const leaf = path[path.length - 1];
  if (typeof obj[leaf] !== "number") throw new Error(`数値フィールドではない: ${lhs}`);
  obj[leaf] = num;
}

// ---- サンプリング ------------------------------------------------------------
/** 1体ぶんを実 LLM に投げて action を取り出す。失敗は null（＝ERROR）として返す（フォールバックしない）。 */
async function sampleSingle(state: WorldState, weather: Weather, c: Character): Promise<Action | null> {
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildSingleUserPrompt(state, weather, c) },
  ];
  try {
    const raw = await chatJSON(messages, { label: `sample:${c.id}` });
    const o = JSON.parse(raw) as { action?: unknown };
    const act = o?.action;
    if (typeof act === "string" && (ACTIONS as string[]).includes(act)) return act as Action;
    throw new Error(`不正な action: ${JSON.stringify(act)}`);
  } catch (err) {
    console.error(`  [ERROR] ${c.id}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** combined: 全員を1プロンプトで1回投げ、characters 配列から id→action を引く（欠け/不正は null）。 */
async function sampleCombined(
  state: WorldState,
  weather: Weather,
  living: Character[],
): Promise<Map<string, Action | null>> {
  const out = new Map<string, Action | null>(living.map((c) => [c.id, null]));
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildUserPrompt(state, weather) },
  ];
  try {
    const raw = await chatJSON(messages, { label: "sample:combined" });
    const parsed = JSON.parse(raw) as { characters?: unknown };
    const arr = Array.isArray(parsed?.characters) ? parsed.characters : [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as { id?: unknown; action?: unknown };
      if (typeof o.id !== "string" || !out.has(o.id)) continue;
      if (typeof o.action === "string" && (ACTIONS as string[]).includes(o.action)) {
        out.set(o.id, o.action as Action);
      } else {
        // 不正 action は黙って捨てず可視化（null のまま＝ERROR として記録される）
        console.error(`  [ERROR] combined ${o.id}: 不正な action: ${JSON.stringify(o.action)}`);
      }
    }
  } catch (err) {
    // 呼び出し/パース自体の失敗＝全員 ERROR（out は全員 null のまま返る）
    console.error("  [ERROR] combined（全員失敗）:", err instanceof Error ? err.message : err);
  }
  return out;
}

// ---- メイン ------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));

const chronicle = createChronicle();
const allIds = createInitialCharacters().map((c) => c.id);
chronicle.roster = args.roster ?? [...allIds];
for (const id of chronicle.roster) {
  if (!allIds.includes(id)) throw new Error(`未知のキャラ id（roster）: ${id}（既知: ${allIds.join(", ")}）`);
}

const state = freshWorldFor(chronicle);
state.weather = args.weather;
for (const s of args.sets) applySet(state, s);

const living = state.characters.filter((c) => c.alive);
if (living.length === 0) throw new Error("生存キャラが0体です（roster / alive を確認）");

const mode: "parallel" | "combined" = args.mode ?? (BACKEND === "ollama" ? "combined" : "parallel");

// 条件スナップショット（記録用）
const condition: Record<string, unknown> = {};
for (const c of living) {
  condition[c.id] = {
    place: c.currentPlaceId,
    energy: c.energy,
    satiety: c.satiety,
    params: { ...c.params },
  };
}
// 同室関係（>1体が同じ場所）
const byPlace = new Map<string, string[]>();
for (const c of living) byPlace.set(c.currentPlaceId, [...(byPlace.get(c.currentPlaceId) ?? []), c.id]);
const rooms = [...byPlace.entries()].filter(([, ids]) => ids.length > 1).map(([place, ids]) => ({ place, ids }));

console.log(`backend=${BACKEND_NAME}:${MODEL}  mode=${mode}  N=${args.n}  weather=${args.weather}`);
console.log(`生存キャラ=${living.length}（${living.map((c) => c.id).join(", ")}）`);
console.log(`目的: ${args.purpose}`);
console.log("--- サンプリング開始 ---");

// id -> action -> count（ERROR は別カウント）
const counts = new Map<string, Map<Action, number>>(living.map((c) => [c.id, new Map()]));
const errors = new Map<string, number>(living.map((c) => [c.id, 0]));
const rawSamples: Record<string, Action | "ERROR">[] = [];

for (let i = 0; i < args.n; i++) {
  // 1サンプル = 全員ぶん（parallel は同時、combined は1回）。サンプル間は直列。
  const picks = new Map<string, Action | null>();
  if (mode === "parallel") {
    const results = await Promise.all(living.map((c) => sampleSingle(state, args.weather, c)));
    living.forEach((c, idx) => picks.set(c.id, results[idx]));
  } else {
    const m = await sampleCombined(state, args.weather, living);
    for (const [id, act] of m) picks.set(id, act);
  }
  const row: Record<string, Action | "ERROR"> = {};
  for (const c of living) {
    const act = picks.get(c.id) ?? null;
    if (act === null) {
      errors.set(c.id, (errors.get(c.id) ?? 0) + 1);
      row[c.id] = "ERROR";
    } else {
      const cm = counts.get(c.id)!;
      cm.set(act, (cm.get(act) ?? 0) + 1);
      row[c.id] = act;
    }
  }
  rawSamples.push(row);
  console.log(`  [${i + 1}/${args.n}] ${living.map((c) => `${c.id}:${row[c.id]}`).join("  ")}`);
}

// ---- 集計表示 ----------------------------------------------------------------
console.log("\n=== 結果 ===");
const results: Record<string, Record<string, number>> = {};
for (const c of living) {
  const cm = counts.get(c.id)!;
  const errN = errors.get(c.id) ?? 0;
  const ok = args.n - errN;
  console.log(`\n${c.id}  @${c.currentPlaceId}  energy=${c.energy} satiety=${c.satiety} altruism=${c.params.altruism}`);
  const sorted = [...cm.entries()].sort((x, y) => y[1] - x[1]);
  const rec: Record<string, number> = {};
  for (const [act, n] of sorted) {
    rec[act] = n;
    const pct = Math.round((n / args.n) * 100);
    console.log(`  ${act.padEnd(8)} ${n}回 (${pct}%)`);
  }
  if (errN > 0) console.log(`  ${"(ERROR)".padEnd(8)} ${errN}回 (${Math.round((errN / args.n) * 100)}%) ← 失敗（分布から除外）`);
  if (ok === 0) console.log(`  ※ ${c.id} は全サンプル失敗。LLM 応答 / 認証を確認してください。`);
  results[c.id] = rec;
}

// ---- 記録（JSONL 追記） ------------------------------------------------------
function gitShortHead(): string {
  const r = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]);
  if (r.exitCode !== 0) throw new Error(`git rev-parse 失敗: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function jstNow(): string {
  // ローカル時刻に依存せず +09:00 固定で記録する
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().replace("Z", "+09:00");
}

const record = {
  datetime: jstNow(),
  commit: gitShortHead(),
  backend: `${BACKEND_NAME}:${MODEL}`,
  mode,
  purpose: args.purpose,
  n: args.n,
  weather: args.weather,
  condition,
  rooms,
  results,
  errors: Object.fromEntries([...errors.entries()].filter(([, v]) => v > 0)),
  rawSamples,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
appendFileSync(OUT_PATH, JSON.stringify(record) + "\n");
console.log(`\n記録を追記しました → ${OUT_PATH}`);
