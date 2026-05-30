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
import { chatJSON } from "./backend.ts";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.ts";

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
    const action = asAction(o.action);
    if (!action) continue;
    byId.set(id, {
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
    });
  }

  // 欠けたキャラはフォールバック（集霊）で埋める
  const characters: CharacterDecision[] = living.map(
    (c) => byId.get(c.id) ?? fallbackDecision(c.id),
  );
  return { characters };
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
