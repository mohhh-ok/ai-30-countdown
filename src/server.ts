// Bun.serve エントリ。API + フロントエンド配信。
// ライブ状態はメモリに保持しつつ、SQLite に永続化する（再起動で復元）。
import type { TickResult, Weather, WorldState } from "./domain/types.ts";
import { createInitialCharacters } from "./domain/characters.ts";
import { placesCopy } from "./domain/places.ts";
import { runTick } from "./domain/engine.ts";
import { createOllamaProvider } from "./llm/decide.ts";
import { createDialogueProvider } from "./llm/dialogue.ts";
import { createDirectorProvider } from "./llm/director.ts";
import { createGuardianProvider } from "./llm/guardian.ts";
import { MODEL as OLLAMA_MODEL, BACKEND_NAME, ping } from "./llm/backend.ts";
import { createRun, loadLatestRun, saveRunSnapshot, saveTick } from "./db.ts";
import index from "./web/index.html";

// --- セッション状態 ---
function freshState(): WorldState {
  return {
    day: 0,
    weather: "normal",
    characters: createInitialCharacters(),
    places: placesCopy(),
    finished: false,
  };
}

// 起動時に最新 run を復元。なければ新規作成。
let state: WorldState;
let weatherHistory: Weather[];
let tickLog: TickResult[];
let runId: number;

const restored = loadLatestRun();
if (restored) {
  state = restored.state;
  weatherHistory = restored.weatherHistory;
  tickLog = restored.log;
  runId = restored.runId;
  console.log(`   復元: run #${runId}（Day ${state.day}・${tickLog.length}日分のログ）`);
} else {
  state = freshState();
  weatherHistory = [];
  tickLog = [];
  runId = createRun(state, OLLAMA_MODEL);
}

const provider = createOllamaProvider();
const dialogueProvider = createDialogueProvider();
const directorProvider = createDirectorProvider();
const guardianProvider = createGuardianProvider();

// 同時 tick を防ぐ簡易ロック（LLM 呼び出し中の二重押し対策）
let ticking = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5566),
  // LLM 応答は数十秒かかることがあるため idle timeout を延長（最大255秒）
  idleTimeout: 255,
  routes: {
    // フロントエンド（bun が React をバンドルして配信）
    "/": index,

    "/api/state": {
      GET: () => json({ state, log: tickLog, model: OLLAMA_MODEL }),
    },

    "/api/health": {
      GET: async () =>
        json({ ollama: await ping(), backend: BACKEND_NAME, model: OLLAMA_MODEL }),
    },

    "/api/tick": {
      POST: async () => {
        if (state.finished) return json({ error: "世界は既に終了しています" }, 409);
        if (ticking) return json({ error: "処理中です" }, 429);
        ticking = true;
        try {
          const result = await runTick(state, weatherHistory, provider, {
            dialogueProvider,
            directorProvider,
            guardianProvider,
            recentLog: tickLog,
          });
          weatherHistory.push(result.weather);
          tickLog.push(result);
          // 永続化（1ティック分の記録 + run スナップショット更新）
          saveTick(runId, result);
          saveRunSnapshot(runId, state, weatherHistory);
          return json({ result, state, model: OLLAMA_MODEL });
        } catch (err) {
          console.error("[tick] error:", err);
          return json(
            { error: err instanceof Error ? err.message : "tick 失敗" },
            500,
          );
        } finally {
          ticking = false;
        }
      },
    },

    "/api/reset": {
      POST: () => {
        // 新しい run を開始（過去 run は履歴として DB に残す）
        state = freshState();
        weatherHistory = [];
        tickLog = [];
        runId = createRun(state, OLLAMA_MODEL);
        return json({ state, log: tickLog });
      },
    },
  },
  development: true,
});

console.log(`🌱 小さなエージェント世界  →  ${server.url}`);
console.log(`   backend: ${BACKEND_NAME} / モデル: ${OLLAMA_MODEL}`);
const ok = await ping();
console.log(
  ok
    ? `   ${BACKEND_NAME}: 接続OK`
    : `   ⚠ ${BACKEND_NAME} に接続できません。`,
);
