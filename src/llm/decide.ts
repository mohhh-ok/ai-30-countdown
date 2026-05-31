// LLM 呼び出し → 構造化結果の検証 → 安全なフォールバック。
import type {
  Action,
  CharacterDecision,
  DecisionProvider,
  Params,
  TickDecision,
  WorldState,
  Weather,
} from "../domain/types.ts";
import { ACTIONS } from "../domain/types.ts";
import { BACKEND, chatJSON } from "./backend.ts";
import { SYSTEM_PROMPT, buildSingleUserPrompt, buildUserPrompt } from "./prompt.ts";

function asAction(v: unknown): Action | null {
  return typeof v === "string" && (ACTIONS as string[]).includes(v)
    ? (v as Action)
    : null;
}

function asParamDeltas(v: unknown): Partial<Params> {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: Partial<Params> = {};
  for (const k of ["altruism", "independence", "trust"] as const) {
    const n = o[k];
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** 応答1オブジェクトを検証して CharacterDecision にする（action が不正なら null） */
function normalizeOne(o: Record<string, unknown>, id: string): CharacterDecision | null {
  const action = asAction(o.action);
  if (!action) return null;
  return {
    id,
    action,
    moveTarget:
      typeof o.moveTarget === "string" && o.moveTarget ? o.moveTarget : undefined,
    targetId:
      typeof o.targetId === "string" && o.targetId ? o.targetId : undefined,
    diary: typeof o.diary === "string" ? o.diary : "",
    relationLabel: typeof o.relationLabel === "string" ? o.relationLabel : "",
    paramDeltas: asParamDeltas(o.paramDeltas),
    deltaReason: typeof o.deltaReason === "string" ? o.deltaReason : "",
  };
}

/** LLM 応答 JSON を検証し、生者ぶんの判断に正規化する（まとめ1回ぶん） */
function parseDecision(raw: string, living: WorldState["characters"]): TickDecision {
  const parsed = JSON.parse(raw) as unknown;
  const arr =
    parsed && typeof parsed === "object" && Array.isArray((parsed as any).characters)
      ? ((parsed as any).characters as unknown[])
      : [];

  const byId = new Map<string, CharacterDecision>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    if (!id || !living.some((c) => c.id === id)) continue;
    const norm = normalizeOne(o, id);
    if (norm) byId.set(id, norm);
  }

  // 欠けたキャラはフォールバック（集霊）で埋める
  const characters: CharacterDecision[] = living.map(
    (c) => byId.get(c.id) ?? fallbackDecision(c.id),
  );
  return { characters };
}

/** 1体ぶんの応答 JSON を検証して判断にする（不正ならフォールバック） */
function parseSingleDecision(raw: string, id: string): CharacterDecision {
  const parsed = JSON.parse(raw) as unknown;
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  return normalizeOne(o, id) ?? fallbackDecision(id);
}

function fallbackDecision(id: string): CharacterDecision {
  return {
    id,
    action: "forage",
    diary: "……今日は、ただ生き延びる。",
    relationLabel: "",
    paramDeltas: {},
    deltaReason: "",
  };
}

/**
 * Ollama を使う判断プロバイダを作る。
 * 1回失敗したらリトライし、それでも駄目なら全員フォールバック。
 */
export function createOllamaProvider(): DecisionProvider {
  return async (state: WorldState, weather: Weather): Promise<TickDecision> => {
    const living = state.characters.filter((c) => c.alive);
    // 全員ぶんを1回のプロンプトにまとめて投げる（直列・少ない呼び出し＝低CPU）。
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: buildUserPrompt(state, weather) },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await chatJSON(messages);
        return parseDecision(raw, living);
      } catch (err) {
        console.error(
          `[decide] attempt ${attempt + 1} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.error("[decide] falling back to default actions");
    return { characters: living.map((c) => fallbackDecision(c.id)) };
  };
}

/**
 * キャラごとに LLM 呼び出しを「並列」で投げる判断プロバイダ。
 * - 各体は buildSingleUserPrompt で自分一人ぶんだけを生成（出力が小さく速い）。
 * - claude-code バックエンドでは 1 呼び出し = 1 プロセス。Promise.all で同時起動するので、
 *   1 体ごとの起動オーバーヘッド（MCP 無しでも ~2s）が重ならず、wall-clock に隠れる。
 * - 1 体が失敗してもその体だけ 1 回リトライ → なお駄目ならフォールバック（全体は止めない）。
 */
export function createParallelProvider(): DecisionProvider {
  return async (state: WorldState, weather: Weather): Promise<TickDecision> => {
    const living = state.characters.filter((c) => c.alive);
    const characters = await Promise.all(
      living.map(async (c) => {
        const messages = [
          { role: "system" as const, content: SYSTEM_PROMPT },
          { role: "user" as const, content: buildSingleUserPrompt(state, weather, c) },
        ];
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await chatJSON(messages);
            return parseSingleDecision(raw, c.id);
          } catch (err) {
            console.error(
              `[decide:parallel] ${c.id} attempt ${attempt + 1} failed:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
        return fallbackDecision(c.id);
      }),
    );
    return { characters };
  };
}

/**
 * 既定の判断プロバイダを選ぶ。
 * - claude-code: 既定で「並列」（キャラ別 claude -p を同時起動＝起動OHを隠す）。
 * - ollama: 既定で「一括」（1 サーバを共有するため並列にしても直列化され、むしろ重い）。
 * - DECIDE_MODE=parallel | combined で明示的に上書きできる。
 */
export function createDecisionProvider(): DecisionProvider {
  const def = BACKEND === "ollama" ? "combined" : "parallel";
  const mode = (process.env.DECIDE_MODE ?? def).toLowerCase();
  return mode === "combined" ? createOllamaProvider() : createParallelProvider();
}
