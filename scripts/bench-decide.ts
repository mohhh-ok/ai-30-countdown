// 判断プロバイダの「並列（キャラ別 claude -p）」と「一括（全員1回）」を、
// 同じ世界状態に対して計測して比較する使い捨てベンチ。
//   bun scripts/bench-decide.ts
// 全キャラ（haru / nagi / kai）を生存させた世界で各モードを1ティックぶん呼ぶ。
import { createChronicle, freshWorldFor } from "../src/domain/campaign.ts";
import { createInitialCharacters } from "../src/domain/characters.ts";
import { createOllamaProvider, createParallelProvider } from "../src/llm/decide.ts";
import { BACKEND_NAME, MODEL } from "../src/llm/backend.ts";

const allIds = createInitialCharacters().map((c) => c.id);
const chronicle = createChronicle();
chronicle.roster = [...allIds]; // 全員を出演させる
const state = freshWorldFor(chronicle);

const living = state.characters.filter((c) => c.alive);
console.log(`backend=${BACKEND_NAME}:${MODEL}  生存キャラ=${living.length}（${living.map((c) => c.id).join(", ")}）`);

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${label.padEnd(10)} ${ms} ms`);
  return r;
}

console.log("\n--- PARALLEL（キャラ別 claude -p を同時起動）---");
const par = await time("parallel", () => createParallelProvider()(state, state.weather));
for (const c of par.characters) console.log(`    ${c.id}: ${c.action}  「${c.diary}」`);

console.log("\n--- COMBINED（全員を1プロンプトで1回）---");
const comb = await time("combined", () => createOllamaProvider()(state, state.weather));
for (const c of comb.characters) console.log(`    ${c.id}: ${c.action}  「${c.diary}」`);
