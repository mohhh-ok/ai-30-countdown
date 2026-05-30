// ヘッドレス CLI シミュレーションランナー。
// パラメータ・初期データを渡して、サーバー無しで N 日を一気に回す。
//
// 例:
//   bun run sim --days 8 --mock                       LLM無しで高速に8日
//   bun run sim --days 10 --seed 42                   天候を再現可能に
//   bun run sim --config examples/harsh.json          初期データをファイルで上書き
//   bun run sim --set haru.energy=40 --set places.kibune.forage.normal=3
//   bun run sim --days 6 --save                        結果を SQLite にも保存
//   bun run sim --days 8 --mock --json                 結果を JSON で出力
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import type {
  Character,
  DecisionProvider,
  DialogueProvider,
  DirectorProvider,
  GuardianProvider,
  Place,
  TickResult,
  Weather,
  WorldState,
} from "./domain/types.ts";
import { createInitialCharacters } from "./domain/characters.ts";
import { placesCopy } from "./domain/places.ts";
import { runTick } from "./domain/engine.ts";
import { ACTION_LABELS } from "./domain/types.ts";
import {
  createMockProvider,
  createMockDialogueProvider,
  createMockDirector,
  createMockGuardian,
  makeRng,
} from "./llm/mock.ts";

const { values } = parseArgs({
  options: {
    days: { type: "string", default: "8" },
    model: { type: "string" },
    config: { type: "string" },
    seed: { type: "string" },
    set: { type: "string", multiple: true, default: [] },
    mock: { type: "boolean", default: false },
    director: { type: "boolean", default: false },
    save: { type: "boolean", default: false },
    "no-dialogue": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`小さなエージェント世界 — ヘッドレス実行

使い方: bun run sim [options]
  --days <n>         進める日数 (default 8)
  --seed <n>         天候の乱数シード（再現性）
  --mock             LLM を使わず簡易ロジックで高速実行
  --director         演出家を有効化（環境に介入してドラマを作る）
  --model <name>     Ollama モデル名 (env OLLAMA_MODEL を上書き)
  --config <path>    初期データ JSON を読み込む（characters/places を上書き or 丸ごと定義）
  --set <path=value> 個別に初期値を上書き（複数可）
                     例: --set haru.energy=40 --set nagi.params.altruism=90
                         --set places.kibune.forage.normal=3
  --save             結果を SQLite (data/world.db) にも保存
  --no-dialogue      会話生成をオフ（速度優先）
  --json             結果を JSON で標準出力
`);
  process.exit(0);
}

if (values.model) process.env.OLLAMA_MODEL = values.model;

// --- 初期状態の構築 ---
function freshState(): WorldState {
  return {
    day: 0,
    weather: "normal",
    characters: createInitialCharacters(),
    places: placesCopy(),
    finished: false,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** ディープマージ（src を dst に上書き）。配列・プリミティブは置き換え。 */
function deepMerge(dst: any, src: any): any {
  for (const k of Object.keys(src)) {
    if (isObject(src[k]) && isObject(dst[k])) deepMerge(dst[k], src[k]);
    else dst[k] = src[k];
  }
  return dst;
}

/** config の characters/places を state に適用。
 *  - characters: { id: Partial<Character> } で部分上書き、未知 id は新規追加
 *  - places:     { id: Partial<Place> } で部分上書き、未知 id は新規追加
 */
function applyConfig(state: WorldState, config: any): void {
  if (isObject(config.characters)) {
    for (const [id, patch] of Object.entries(config.characters)) {
      const existing = state.characters.find((c) => c.id === id);
      if (existing) deepMerge(existing, patch);
      else state.characters.push(newCharacterTemplate(id, state, patch as object));
    }
  }
  if (isObject(config.places)) {
    for (const [id, patch] of Object.entries(config.places)) {
      const existing = state.places.find((p) => p.id === id);
      if (existing) deepMerge(existing, patch);
      else state.places.push(newPlaceTemplate(id, patch as object));
    }
  }
}

function newCharacterTemplate(id: string, state: WorldState, patch: object): Character {
  const base: Character = {
    id,
    name: id,
    core: "",
    background: "",
    initialLesson: "",
    growthAxis: "altruism",
    talent: "none",
    satiety: 40,
    sensitization: { achievement: 0.3, bond: 0.3, comfort: 0.3, thrill: 0.4 },
    clearance: 0.15,
    lonelinessSensitivity: 5,
    antibodies: { achievement: 0, bond: 0, comfort: 0, thrill: 0 },
    mood: { elation: 0, calm: 0, warmth: 0, stress: 0 },
    energy: 60,
    params: { altruism: 50, independence: 50, trust: 50 },
    alive: true,
    currentPlaceId: state.places[0]?.id ?? "kamogawa",
    episodicMemory: [],
    diary: [],
    relationLabel: "",
  };
  return deepMerge(base, patch);
}

function newPlaceTemplate(id: string, patch: object): Place {
  const base: Place = {
    id,
    name: id,
    description: "",
    forage: { normal: 12, lean: 4 },
    populace: { sei: 40, daku: 20 },
    populaceMax: { sei: 40, daku: 20 },
    regen: { sei: 6, daku: 3 },
    neighbors: [],
  };
  return deepMerge(base, patch);
}

/** "haru.energy=40" / "places.kibune.forage.normal=3" を適用 */
function applySet(state: WorldState, entry: string): void {
  const eq = entry.indexOf("=");
  if (eq < 0) {
    console.warn(`[--set] '=' がありません: ${entry}`);
    return;
  }
  const path = entry.slice(0, eq).trim();
  const rawVal = entry.slice(eq + 1).trim();
  const keys = path.split(".");

  let root: any;
  if (keys[0] === "places") {
    root = state.places.find((p) => p.id === keys[1]);
    keys.splice(0, 2);
  } else {
    root = state.characters.find((c) => c.id === keys[0]);
    keys.splice(0, 1);
  }
  if (!root) {
    console.warn(`[--set] 対象が見つかりません: ${path}`);
    return;
  }
  let o = root;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObject(o[keys[i]])) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = coerce(rawVal);
}

function coerce(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

// --- 構築 ---
const state = freshState();
if (values.config) {
  const cfg = JSON.parse(readFileSync(values.config, "utf8"));
  if (typeof cfg.days === "number" && !process.argv.includes("--days")) {
    values.days = String(cfg.days);
  }
  if (typeof cfg.seed === "number" && values.seed === undefined) {
    values.seed = String(cfg.seed);
  }
  applyConfig(state, cfg);
}
for (const entry of values.set as string[]) applySet(state, entry);

const days = Number(values.days);
const rng = values.seed !== undefined ? makeRng(Number(values.seed)) : Math.random;

// --- プロバイダ選択（mock or Ollama） ---
let provider: DecisionProvider;
let dialogueProvider: DialogueProvider | undefined;
let directorProvider: DirectorProvider | undefined;
let guardianProvider: GuardianProvider | undefined;
if (values.mock) {
  provider = createMockProvider(rng);
  dialogueProvider = values["no-dialogue"] ? undefined : createMockDialogueProvider();
  if (values.director) {
    directorProvider = createMockDirector(rng);
    guardianProvider = createMockGuardian();
  }
} else {
  const { createOllamaProvider } = await import("./llm/decide.ts");
  provider = createOllamaProvider();
  if (!values["no-dialogue"]) {
    const { createDialogueProvider } = await import("./llm/dialogue.ts");
    dialogueProvider = createDialogueProvider();
  }
  if (values.director) {
    const { createDirectorProvider } = await import("./llm/director.ts");
    directorProvider = createDirectorProvider();
    const { createGuardianProvider } = await import("./llm/guardian.ts");
    guardianProvider = createGuardianProvider();
  }
}

// --- DB（--save のときだけ） ---
let saveTickFn: ((runId: number, r: TickResult) => void) | null = null;
let runId = 0;
if (values.save) {
  const db = await import("./db.ts");
  runId = db.createRun(state, process.env.OLLAMA_MODEL ?? "mock");
  saveTickFn = db.saveTick;
}

// --- 実行 ---
const placeName = (id: string) => state.places.find((p) => p.id === id)?.name ?? id;
const weatherHistory: Weather[] = [];
const results: TickResult[] = [];

if (!values.json) {
  console.log(
    `▶ ${days}日 / ${values.mock ? "mock" : "Ollama:" + (process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct")}` +
      `${values.seed !== undefined ? " / seed=" + values.seed : ""}` +
      `${values["no-dialogue"] ? " / 会話オフ" : ""}${values.save ? " / DB保存" : ""}`,
  );
  const init = state.characters
    .map((c) => `${c.name}@${placeName(c.currentPlaceId)}(E${c.energy})`)
    .join(" / ");
  console.log(`  初期: ${init}\n`);
}

for (let i = 0; i < days; i++) {
  const result = await runTick(state, weatherHistory, provider, {
    dialogueProvider,
    directorProvider,
    guardianProvider,
    rng,
    recentLog: results,
  });
  weatherHistory.push(result.weather);
  results.push(result);
  if (saveTickFn) {
    saveTickFn(runId, result);
    const db = await import("./db.ts");
    db.saveRunSnapshot(runId, state, weatherHistory);
  }

  if (!values.json) {
    const line = result.characters
      .map((c) => {
        const act = c.moved ? `→${c.placeName}` : ACTION_LABELS[c.action];
        return `${c.name}:${act} E${c.energyBefore}→${c.energyAfter}(利${c.paramsAfter.altruism}/自${c.paramsAfter.independence}/信${c.paramsAfter.trust})${c.died ? " †" : ""}`;
      })
      .join("  ");
    console.log(`Day${result.day} [${result.weather === "normal" ? "通常" : "不作"}] ${line}`);
    // 京の枯れ具合（民の霊力 清/濁）
    const kyo = state.places
      .map((p) => `${p.name}:清${p.populace.sei}/濁${p.populace.daku}`)
      .join("  ");
    console.log(`   ⛩ 京の気: ${kyo}`);
    if (result.director) {
      console.log(`   🎬 ${result.director.narration}`);
      const boosts = result.director.forageBoosts
        .map((b) => `${placeName(b.placeId)}${b.delta >= 0 ? "+" : ""}${b.delta}`)
        .join("、");
      console.log(
        `      [演出 緊張度:${result.director.tension} 意図:${result.director.intent}` +
          `${boosts ? " 実り操作:" + boosts : ""}]`,
      );
    }
    if (result.spotlightName) {
      console.log(
        `   🎥 主役: ${result.spotlightName}` +
          `${result.spotlightReason ? "（" + result.spotlightReason + "）" : ""}`,
      );
    }
    if (result.whispers?.length) {
      for (const w of result.whispers) {
        const nm = state.characters.find((c) => c.id === w.id)?.name ?? w.id;
        console.log(`   🕊️ 守護神→${nm}: 「${w.whisper}」`);
      }
    }
    // 報酬・気分・抗体（観察用）
    for (const c of result.characters) {
      const ev = c.rewardEvents
        .map((e) => `${e.label}(${e.effective >= 0 ? "+" : ""}${e.effective})`)
        .join("、");
      const m = c.mood;
      const ab = c.antibodies;
      console.log(
        `   ${c.name} 報酬:${ev || "なし"}\n` +
          `      気分[高揚${m.elation}/安${m.calm}/温${m.warmth}/ストレス${m.stress}] ` +
          `抗体[達成${ab.achievement}/絆${ab.bond}/安${ab.comfort}/背徳${ab.thrill}]`,
      );
    }
    if (result.dialogue?.length) {
      for (const l of result.dialogue) console.log(`   💬 ${l.speakerName}: ${l.text}`);
    }
    if (result.notable !== "特になし") console.log(`   ▶ ${result.notable}`);
  }
  if (state.finished) break;
}

// --- 出力 ---
if (values.json) {
  console.log(JSON.stringify({ results, finalState: state }, null, 2));
} else {
  console.log("\n=== 最終状態 ===");
  for (const c of state.characters) {
    console.log(
      `${c.name}: ${c.alive ? "生存" : "死亡"} E${c.energy} @${placeName(c.currentPlaceId)} ` +
        `利他${c.params.altruism}/自立${c.params.independence}/信頼${c.params.trust}`,
    );
  }
  if (values.save) console.log(`\n（run #${runId} として data/world.db に保存）`);
}
