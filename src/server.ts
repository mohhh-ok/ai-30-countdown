// Bun.serve エントリ。API + フロントエンド配信。
// 回帰（ローグライク）ランナーをメモリに保持しつつ、SQLite に永続化する（再起動で復元）。
import type { TickResult } from "./domain/types.ts";
import { runTick } from "./domain/engine.ts";
import { Campaign } from "./domain/campaign.ts";
import { createDecisionProvider } from "./llm/decide.ts";
import { createOneShotDialogueProvider } from "./llm/dialogue.ts";
import { createDirectorGuardianProviders } from "./llm/director_guardian.ts";
import { createOneCallProviders } from "./llm/onecall.ts";
import { MODEL as OLLAMA_MODEL, BACKEND_NAME, ping } from "./llm/backend.ts";
import { beginTickTiming, endTickTiming } from "./llm/timing.ts";
import { llog } from "./llm/log.ts";
import {
  createRun,
  loadLatestRun,
  loadLoopTicks,
  loadCharacterTrace,
  saveRunState,
  saveTick,
  saveLlmTimings,
  saveSkillAudit,
} from "./db.ts";
import index from "./web/index.html";

// --- セッション状態（回帰: ハルが力尽きるたび Day1 へ巻き戻る年代記） ---
// 表示ログは「現在の回帰ぶんだけ」をメモリに持つ（= campaign.loopLog）。全周ログは常駐させず、
// 過去の回帰は /api/loops/:loop で DB からオンデマンドに引く（起動時の全件ロードを避ける）。
let campaign: Campaign;
let runId: number;

const restored = loadLatestRun();
if (restored) {
  campaign = Campaign.restore(restored.save, restored.loopTicks);
  runId = restored.runId;
  console.log(
    `   復元: run #${runId}（Loop ${campaign.chronicle.loop}・Day ${campaign.world.day}・現周 ${campaign.loopLog.length}日）`,
  );
} else {
  campaign = new Campaign();
  runId = createRun(campaign.save(), OLLAMA_MODEL);
}

// LLM_ONECALL=1 のときは、1プロセスの claude -p が Task で全役を分担し1ティックを1 JSONで返す
// 特殊バリアントに差し替える（env を外せば従来の4プロバイダに即復帰。runTick は無改造）。
const onecall =
  BACKEND_NAME === "claude-code" &&
  (process.env.LLM_ONECALL === "1" || process.env.LLM_ONECALL === "true");
const onecallProviders = onecall ? createOneCallProviders() : null;
// 通常パス（onecall でないとき）は逐次段を削った構成:
//   director+guardian を1コールに統合 / decide は並列(キャラ増でも wall-clock 一定) / 会話は一括生成。
const dirGuard = onecallProviders ? null : createDirectorGuardianProviders();
const provider = onecallProviders?.decision ?? createDecisionProvider();
const dialogueProvider = onecallProviders?.dialogue ?? createOneShotDialogueProvider();
const directorProvider = onecallProviders?.director ?? dirGuard!.director;
const guardianProvider = onecallProviders?.guardian ?? dirGuard!.guardian;

// 開発時はフロントの HMR・画像の再取得を効かせる（本番は NODE_ENV=production で長期キャッシュ）
const DEV = process.env.NODE_ENV !== "production";

// 同時 tick を防ぐ簡易ロック（LLM 呼び出し中の二重押し対策）
let ticking = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 1ティック進めて永続化する。二重実行の防止は呼び出し側（ticking ロック）の責務。
async function runOneTick(): Promise<TickResult> {
  const tickT0 = performance.now();
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
  campaign.recordTick(result); // スキル進捗・キャラ解放・回帰判定（現周ログ loopLog も内部で更新）
  // 永続化（復元スナップショット1本 + その日の tick 行 + LLM計測の正規化行）
  // 表示ログは campaign.loopLog（現周ぶん）。DB には ticks に1日1行だけ足す（肥大しない）。
  saveTick(runId, result);
  saveRunState(runId, campaign.save());
  saveLlmTimings(runId, result.loop ?? 1, result.day, result.llmTimings);
  // 到達可能性の監査ログ（毎 tick のスキル進捗・利他・解放ロスターのスナップ）。
  // loop スコープのスキルは周頭でリセットされるため、毎日残して時系列で最大到達を追えるようにする。
  // loop は recordTick が result に付与した「その tick が起きた周」を使う（回帰した tick では
  // chronicle.loop は既に次周へ加算済みなので、フォールバックは next-loop ではなく 1 にする）。
  // heroAltruism はその日のハル利他。ハルが result に居ない日は 0（peak 値で誤魔化さない）。
  const heroResult = result.characters.find((c) => c.id === campaign.protagonistId);
  saveSkillAudit(runId, {
    loop: result.loop ?? 1,
    day: result.day,
    heroAltruism: heroResult?.paramsAfter.altruism ?? 0,
    peakAltruism: campaign.chronicle.heroPeakAltruism,
    acquired: [...campaign.chronicle.skills.acquired],
    progress: { ...campaign.chronicle.skills.progress },
    roster: [...campaign.chronicle.roster],
  });
  return result;
}

// --- サーバ側ワーカー（自走進行） ---
// ワーカーはサーバが自律的に回し続けるので、ブラウザを閉じても世界は進む（配信モデル向き）。
// 進行はこのワーカーだけが行い、外部から開始・停止する API は持たない（公開時のいたずら防止）。
const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 1000);
let workerOn = false;

async function workerLoop() {
  llog("server", "worker→start", { intervalMs: WORKER_INTERVAL_MS });
  while (workerOn) {
    if (ticking) {
      // 手動 tick 等と衝突したら少し待って再挑戦
      await Bun.sleep(200);
      continue;
    }
    ticking = true;
    try {
      await runOneTick();
    } catch (err) {
      llog("server", "✗worker-tick-error", {
        err: err instanceof Error ? err.message : String(err),
      });
      console.error("[worker] tick error:", err);
      // LLM 不通などで連打しないよう、エラー時は長めに待つ
      await Bun.sleep(5000);
    } finally {
      ticking = false;
    }
    await Bun.sleep(WORKER_INTERVAL_MS);
  }
  llog("server", "worker→stopped");
}

function startWorker() {
  if (workerOn) return;
  workerOn = true;
  void workerLoop();
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5566),
  // LLM 応答は数十秒かかることがあるため idle timeout を延長（最大255秒）
  idleTimeout: 255,
  routes: {
    // フロントエンド（bun が React をバンドルして配信）
    "/": index,

    // ホームは「現在の回帰ぶん」だけ返す（全周ログは送らない＝配信が肥大しない）。
    "/api/state": {
      GET: () =>
        json({
          state: campaign.world,
          log: campaign.loopLog, // 現周のログのみ。過去周は /api/loops/:loop で引く
          chronicle: campaign.chronicle,
          running: workerOn,
          model: OLLAMA_MODEL,
        }),
    },

    // 過去の回帰の物語（その周の完全 ticks を日付順に）。LoopPage がオンデマンドに取得する。
    "/api/loops/:loop": {
      GET: (req) => {
        const loop = Number(req.params.loop);
        if (!Number.isInteger(loop) || loop < 1) return json({ error: "bad loop" }, 400);
        // 現在進行中の回帰はメモリの loopLog をそのまま返す（DBにまだ全部入っていない日があるため）。
        // 注意: 回帰が起きた tick の直後は、その周が closeLoop で chronicle.loop を進めて loopLog を
        // リセットし終えた一方、saveTick 完了までの数ms はその周の最終日が DB に未反映でありうる。
        // その瞬間だけ最終日が一瞬欠けるが、観るだけ画面で次のポーリング（数秒）で回復する。
        const ticks =
          loop === campaign.chronicle.loop ? campaign.loopLog : loadLoopTicks(runId, loop);
        return json({ loop, ticks });
      },
    },

    // キャラ別ページ（全周横断）。重い TickResult ではなく char_metrics の薄い軌跡を返す。
    "/api/character/:id": {
      GET: (req) => {
        const id = req.params.id.replace(/[^a-z0-9_]/gi, "");
        if (!id) return json({ error: "bad id" }, 400); // /assets と対称にガード
        return json({ id, trace: loadCharacterTrace(runId, id) });
      },
    },

    "/api/health": {
      GET: async () =>
        json({ ollama: await ping(), backend: BACKEND_NAME, model: OLLAMA_MODEL }),
    },

    // キャラ絵（assets/characters/<id>.webp）。ファイル名以外の文字は除去（パストラバーサル対策）。
    "/assets/characters/:file": {
      GET: async (req) => {
        const safe = req.params.file.replace(/[^a-z0-9_.-]/gi, "");
        const f = Bun.file(`assets/characters/${safe}`);
        if (!(await f.exists())) return new Response("not found", { status: 404 });
        return new Response(f, {
          // dev は再生成した絵がすぐ見えるようキャッシュ無効。本番のみ長期キャッシュ。
          headers: { "Cache-Control": DEV ? "no-store" : "public, max-age=86400" },
        });
      },
    },

    // 場所の背景絵（assets/places/<id>.webp）。キャラ絵と同様にサニタイズして配信。
    "/assets/places/:file": {
      GET: async (req) => {
        const safe = req.params.file.replace(/[^a-z0-9_.-]/gi, "");
        const f = Bun.file(`assets/places/${safe}`);
        if (!(await f.exists())) return new Response("not found", { status: 404 });
        return new Response(f, {
          headers: { "Cache-Control": DEV ? "no-store" : "public, max-age=86400" },
        });
      },
    },

    // タイトルロゴ（assets/title.webp）。単一ファイルなので固定パスで配信。
    "/assets/title.webp": {
      GET: async () => {
        const f = Bun.file("assets/title.webp");
        if (!(await f.exists())) return new Response("not found", { status: 404 });
        return new Response(f, {
          headers: { "Cache-Control": DEV ? "no-store" : "public, max-age=86400" },
        });
      },
    },

  },
  development: DEV,
});

console.log(`🌱 小さなエージェント世界  →  ${server.url}`);
console.log(`   backend: ${BACKEND_NAME} / モデル: ${OLLAMA_MODEL}`);
const ok = await ping();
console.log(
  ok
    ? `   ${BACKEND_NAME}: 接続OK`
    : `   ⚠ ${BACKEND_NAME} に接続できません。`,
);

// 配信モデル: 起動と同時にワーカーを立ち上げ、自走で世界を進め続ける（外部から停止する手段は持たない）
startWorker();
console.log(`   ワーカー起動（自動進行 / 間隔 ${WORKER_INTERVAL_MS}ms）`);
