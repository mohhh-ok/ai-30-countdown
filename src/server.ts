// Bun.serve エントリ。API + フロントエンド配信。
// 回帰（ローグライク）ランナーをメモリに保持しつつ、SQLite に永続化する（再起動で復元）。
import type { TickResult } from "./domain/types.ts";
import { runTick } from "./domain/engine.ts";
import { Campaign } from "./domain/campaign.ts";
import { createDecisionProvider } from "./llm/decide.ts";
import { createDialogueProvider } from "./llm/dialogue.ts";
import { createDirectorProvider } from "./llm/director.ts";
import { createGuardianProvider } from "./llm/guardian.ts";
import { createOneCallProviders } from "./llm/onecall.ts";
import { MODEL as OLLAMA_MODEL, BACKEND_NAME, ping } from "./llm/backend.ts";
import { beginTickTiming, endTickTiming } from "./llm/timing.ts";
import { llog } from "./llm/log.ts";
import {
  createCampaign,
  loadLatestCampaign,
  saveCampaign,
  saveLlmTimings,
} from "./db.ts";
import index from "./web/index.html";

// --- セッション状態（回帰: ハルが力尽きるたび Day1 へ巻き戻る年代記） ---
let campaign: Campaign;
let tickLog: TickResult[]; // 全周をまたいだ表示用ログ
let campaignId: number;

const restored = loadLatestCampaign();
if (restored) {
  campaign = Campaign.restore(restored.snapshot);
  tickLog = restored.log;
  campaignId = restored.id;
  console.log(
    `   復元: campaign #${campaignId}（Loop ${campaign.chronicle.loop}・Day ${campaign.world.day}・${tickLog.length}日分のログ）`,
  );
} else {
  campaign = new Campaign();
  tickLog = [];
  campaignId = createCampaign(campaign.snapshot(), OLLAMA_MODEL);
}

// LLM_ONECALL=1 のときは、1プロセスの claude -p が Task で全役を分担し1ティックを1 JSONで返す
// 特殊バリアントに差し替える（env を外せば従来の4プロバイダに即復帰。runTick は無改造）。
const onecall =
  BACKEND_NAME === "claude-code" &&
  (process.env.LLM_ONECALL === "1" || process.env.LLM_ONECALL === "true");
const onecallProviders = onecall ? createOneCallProviders() : null;
const provider = onecallProviders?.decision ?? createDecisionProvider();
const dialogueProvider = onecallProviders?.dialogue ?? createDialogueProvider();
const directorProvider = onecallProviders?.director ?? createDirectorProvider();
const guardianProvider = onecallProviders?.guardian ?? createGuardianProvider();

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
      GET: () =>
        json({
          state: campaign.world,
          log: tickLog,
          chronicle: campaign.chronicle,
          model: OLLAMA_MODEL,
        }),
    },

    "/api/health": {
      GET: async () =>
        json({ ollama: await ping(), backend: BACKEND_NAME, model: OLLAMA_MODEL }),
    },

    "/api/tick": {
      POST: async () => {
        // 回帰モードに「終了」はない（ハルが死ねば巻き戻る）。二重押しだけ防ぐ。
        if (ticking) {
          llog("server", "⚠tick 二重押し→429（処理中）");
          return json({ error: "処理中です" }, 429);
        }
        ticking = true;
        const tickT0 = performance.now();
        try {
          const world = campaign.world; // この日の世界（recordTick で回帰すると次周へ差し替わる）
          llog("server", "tick→start", {
            loop: campaign.chronicle.loop,
            day: world.day + 1,
            onecall: onecall ? "yes" : "no",
          });
          beginTickTiming(); // この tick の LLM 呼び出し時間を集める
          const result = await runTick(world, campaign.weatherHistory, provider, {
            dialogueProvider,
            directorProvider,
            guardianProvider,
            recentLog: campaign.loopLog,
            protagonistId: campaign.protagonistId,
            skillEffects: campaign.effects(),
          });
          result.llmTimings = endTickTiming(); // result に載せて UI へ流す
          llog("server", "tick→done", {
            day: result.day,
            ms: Math.round(performance.now() - tickT0),
            tempo: result.tempo,
            calls: result.llmTimings?.length ?? 0,
          });
          campaign.recordTick(result); // スキル進捗・キャラ解放・回帰判定
          tickLog.push(result);
          // 永続化（年代記スナップショット + 表示用ログ + LLM計測の正規化行）
          saveCampaign(campaignId, campaign.snapshot(), tickLog);
          saveLlmTimings("campaign", campaignId, result.loop ?? 1, result.day, result.llmTimings);
          return json({
            result,
            state: campaign.world,
            chronicle: campaign.chronicle,
            model: OLLAMA_MODEL,
          });
        } catch (err) {
          llog("server", "✗tick-error", {
            ms: Math.round(performance.now() - tickT0),
            err: err instanceof Error ? err.message : String(err),
          });
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
        // 新しい年代記を始める（過去キャンペーンは履歴として DB に残す）
        campaign = new Campaign();
        tickLog = [];
        campaignId = createCampaign(campaign.snapshot(), OLLAMA_MODEL);
        return json({ state: campaign.world, log: tickLog, chronicle: campaign.chronicle });
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
