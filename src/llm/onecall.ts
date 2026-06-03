// 「claude -p を1プロセスだけ起動し、その中で Task サブエージェントを fan-out して
//  1ティック分（演出・各キャラ判断・会話）を1つの JSON にまとめて返す」特殊バリアント。
//
// 設計（アダプタ・即戻せる）:
//  - runTick は無改造のまま。既存の DirectorProvider / GuardianProvider / DecisionProvider /
//    DialogueProvider の「型」に被せる薄いシムを返す。
//  - 実コール（claude -p）は director シムが最初に呼ばれた瞬間に1回だけ走り、TickPlan を作って
//    per-tick キャッシュに置く。guardian/decide/dialogue シムはそのキャッシュから自分の取り分を返す。
//  - env を切れば（配線側で）従来の4プロバイダに即復帰する。
//
// なぜサブエージェントか:
//  - 4役（director/各キャラ判断/会話）を1つの巨大プロンプトに詰めると文脈が混ざって精度が落ちる。
//  - Task で役・キャラ単位に分ければ各サブエージェントはクリーンな個別文脈で考えられる。
//  - プロセス起動（~数秒の足場）は1回で済むので、N プロセス起動より wall-clock が軽い。
import type {
  Action,
  Character,
  CharacterDecision,
  DecisionProvider,
  DialogueLine,
  DialogueProvider,
  DirectorDecision,
  DirectorProvider,
  GuardianProvider,
  GuardianWhisper,
  Params,
  TickDecision,
  TickResult,
  Tension,
  Weather,
  WorldState,
} from "../domain/types.ts";
import { ACTIONS, ACTION_LABELS } from "../domain/types.ts";
import { findPlace } from "../domain/places.ts";
import { chatJSON, normalizeLocalized } from "./backend.ts";
import { llog } from "./log.ts";
import { SYSTEM_PROMPT, ACTION_MENU, characterBlock } from "./prompt.ts";

/** 1ティック分の「LLM が決める部分」をまとめたもの。数値計算はエンジンが別途行う。 */
interface TickPlan {
  director: DirectorDecision;
  whispers: GuardianWhisper[];
  decision: TickDecision;
  dialogue: DialogueLine[];
}

const MAX_DIALOGUE_LINES = 8; // 暴走防止の上限（engine 側でも MAX_TURNS で頭打ち）

// ---- 検証ヘルパ（decide.ts / director.ts の正規化を onecall 用に内包） ----

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

function normalizeOne(o: Record<string, unknown>, id: string): CharacterDecision | null {
  const action = asAction(o.action);
  if (!action) return null;
  return {
    id,
    action,
    moveTarget: typeof o.moveTarget === "string" && o.moveTarget ? o.moveTarget : undefined,
    targetId: typeof o.targetId === "string" && o.targetId ? o.targetId : undefined,
    diary: typeof o.diary === "string" ? o.diary : "",
    relationLabel: typeof o.relationLabel === "string" ? o.relationLabel : "",
    paramDeltas: asParamDeltas(o.paramDeltas),
    deltaReason: typeof o.deltaReason === "string" ? o.deltaReason : "",
  };
}

function fallbackDecision(id: string): CharacterDecision {
  return {
    id,
    action: "forage",
    diary: "とりまサバイブ最優先っしょ。",
    relationLabel: "",
    paramDeltas: {},
    deltaReason: "",
  };
}

// ---- プロンプト構築 ----

export const ORCHESTRATOR_SYSTEM = `あなたは「妖の京（あやかしのみやこ）」の1日を統括する進行役（オーケストレータ）です。
あなた自身は各キャラの行動を直接決めず、サブエージェント（Task ツール）に分担させて結果を集約します。

手順を厳密に守ること:
1. まず「演出家」として、この1日の環境を決める: 天候(normal/lean)・幕開けナレーション・演出意図(intent)・場所の実り増減(forageBoosts)・主役(spotlight)・各キャラへの守護神の指示(directives)と一人称の囁き(whispers)。
   - キャラの芯・行動は直接操作しない。動かせるのは環境と「囁き」だけ。三つの霊地は1日で行き来でき出会いは起きやすいので、出会いを人為的に演出しない（実りでの引き寄せ・毎日の「会いたい」囁きは禁止）。誰と関わるかは各人の芯に委ねる。
   - directives には「この者をどう動かしたいか＝あなた（演出家）が見たい絵」を書く。intent（その日の演出の狙い）に沿わせること。
   - whispers は、その directive を **本人の芯と今の気分に根ざした一人称の内なる声に翻訳したもの**。命令口調にしない（背中をそっと押す／迷いを言葉にする／欲求を自覚させる）。芯に反する強制はしない（強いても本人は抗ってよい）。directive を与えた各キャラには必ず対応する whisper を作り、囁きが演出家の欲しい絵を体現するようにする。
2. 次に、生者ひとりにつき1つ、Task ツールでサブエージェント（subagent_type "general-purpose"）を **並列に** 起動する（1メッセージ内でまとめて呼ぶ）。
   - 各サブエージェントには、与えられた「キャラ判断プロンプト（そのキャラ専用）」をそのまま渡す。
   - その際、プロンプト末尾に「今日の天候: <あなたが決めた天候>」を1行加える。そのキャラに囁き(whisper)があるなら「心の声（守護神のささやき。演出家の意図を本人の声に翻訳したもの。従っても抗ってもよい）: <囁き>」も1行加える。この囁きを通じてのみ演出家の意図がそのキャラに届く（directive 文そのものは渡さない）。
   - 各サブエージェントは、そのキャラ1人ぶんの行動JSONを返す。あなたはそれを受け取る。
   - サブエージェントには **ツールを一切使わせない**（ファイル読み込み・コード探索・コマンド実行は不要かつ禁止）。渡した情報だけで判断し、JSON だけを返させること。余計な探索はレイテンシの無駄。
3. すべてのキャラ判断が揃ったら、同じ霊地にいる2人が互いに talk を選んでいるか確認する。成立していれば、Task でもう1つサブエージェントを起動し、その2人の会話劇（交互の短いセリフ・最初の話者は talk を選んだ側）を書かせる。成立していなければ会話は空配列。
4. 最後に、すべてを下記スキーマの **1つの JSON オブジェクト** にまとめて出力する。JSON 以外（説明・前置き・コードブロック外の文）は一切書かない。`;

function directorContext(state: WorldState, tension: Tension, recentLog: TickResult[]): string {
  const living = state.characters.filter((c) => c.alive);
  const cast = living
    .map((c) => {
      const place = findPlace(state.places, c.currentPlaceId)?.name ?? c.currentPlaceId;
      return `- ${c.name}(id:${c.id}): 霊力${c.energy} @${place} ｜ 気分(高揚${c.mood.elation}/温${c.mood.warmth}/安${c.mood.calm}/ストレス${c.mood.stress}) ｜ 相手への感情:${c.relationLabel}`;
    })
    .join("\n");
  const placeList = state.places
    .map(
      (p) =>
        `  - "${p.id}"（${p.name}）民の霊力 和み${p.populace.sei}/荒び${p.populace.daku}（頂ける上限${p.forage.normal}）`,
    )
    .join("\n");
  const recent =
    recentLog
      .slice(-3)
      .map((t) => {
        const acts = t.characters.map((c) => `${c.name}=${c.actionLabel}`).join("/");
        return `  Day${t.day}[${t.weather === "normal" ? "通常" : "不作"}] ${acts}`;
      })
      .join("\n") || "  （まだない）";
  const places = new Set(living.map((c) => c.currentPlaceId));
  const separated = living.length >= 2 && places.size > 1;
  const soloName = living[0]?.name ?? "主人公";
  const sepNote =
    living.length === 1
      ? `※ 今、京にいる妖は ${soloName} 独りだけ。ほかに妖はいない。ナレーションでも囁きでも「三人」「二人」「仲間」「あの者たち」など他者の存在を一切匂わせないこと（独りであることが今この物語の事実）。`
      : separated
        ? "※ 登場人物は今、別々の場所にいる（各地は隣接する霊地へ1日で移ろえる）。出会いは無理に作らず各人の芯に委ねること（実りでの引き寄せ・毎日の「会いたい」囁きは禁止）。"
        : "※ 登場人物は同じ場所にいる。";
  const prevSpotId = recentLog.length ? recentLog[recentLog.length - 1].spotlightId : undefined;
  const prevSpotName = prevSpotId
    ? state.characters.find((c) => c.id === prevSpotId)?.name ?? prevSpotId
    : "（まだない）";
  const tensionLabel: Record<Tension, string> = {
    calm: "平穏（やや退屈になりかけ）",
    stagnant: "膠着（同じ行動の繰り返しで停滞）",
    tense: "緊迫（葛藤や危機が高まっている）",
    tragic: "悲劇接近（誰かが力尽きる寸前）",
  };
  return `緊張度: ${tensionLabel[tension]}
${sepNote}
前回カメラを向けた主役: ${prevSpotName}

登場人物:
${cast}

直近の流れ:
${recent}

場所（実りを一時操作できる。id 指定）:
${placeList}`;
}

/** キャラ1人ぶんの判断サブエージェント用プロンプト（天候・囁きはオーケストレータが末尾に付ける）。 */
function characterSubPrompt(state: WorldState, self: Character, others: Character[]): string {
  // characterBlock は weather を使わないのでダミーを渡す。囁きは c.currentWhisper 未設定のため出ない。
  const block = characterBlock(self, "normal", state.places, others);
  const soloNote =
    others.length === 0
      ? "\n\n※ 今この京に妖はあなた独りだけ。仲間も他の妖も存在しない。日記・内省でも「あの二人」「みんな」など実在しない他者を語らないこと（語りかける・分け与える・奪う・寄り添う相手は誰もいない）。"
      : "";
  const schema = `{
  "action": "次のいずれか1つ: ${Object.keys(ACTION_LABELS).map((k) => `"${k}"`).join(", ")}",
  "moveTarget": "action が \\"move\\" のときだけ移ろう先の場所id。それ以外は空文字",
  "targetId": "action が talk/share/steal のときは同じ地の相手の id、follow のときは寄り添う相手の id（離れていても可）。それ以外は空文字",
  "diary": "一人称・一行の内省（日本語・pop口調。タメ口で軽快に、記号や絵文字も可）",
  "relationLabel": "相手への現在の感情ラベル（pop口調の口語ひと言。例: ガチ警戒 / なんか好き / マジ無理 など）",
  "paramDeltas": { "altruism": 整数(-5〜5), "independence": 整数(-5〜5), "trust": 整数(-5〜5) },
  "deltaReason": "パラメータを動かした理由を一行で。動かさないなら空文字"
}`;
  return `（重要: ツールは一切使わないこと。ファイル読み込み・探索・コマンド実行は不要。以下の情報だけで判断し、最後に JSON だけを返す。）

${SYSTEM_PROMPT}

選べる行動:
${ACTION_MENU}

あなたは次の妖です。あなた一人の、この1日の行動を1つだけ決めてください:

${block}${soloNote}

あなたの芯と気質・異能・記憶・周りの妖の居場所・霊地の枯れ具合を踏まえて選ぶこと。関わりたい相手が離れているなら "move" で近づくことも、枯れた地なら霊力の残る地へ移ろうことも検討。同じ地に複数いるなら targetId で相手を選ぶ。パラメータ変動は今日の出来事に基づいてのみ（理由が無ければ0）。

次の JSON だけを出力（あなた一人ぶんの1オブジェクト・説明なし）:
${schema}`;
}

export function buildOrchestratorUserPrompt(
  state: WorldState,
  tension: Tension,
  recentLog: TickResult[],
): string {
  const living = state.characters.filter((c) => c.alive);
  const ids = living.map((c) => c.id);
  const subBlocks = living
    .map((c) => {
      const others = living.filter((o) => o.id !== c.id);
      const sub = characterSubPrompt(state, c, others);
      return `── ${c.name}（id: ${c.id}）に渡すキャラ判断プロンプト ──\n${sub}`;
    })
    .join("\n\n");

  const schema = `{
  "director": {
    "weather": "normal | lean",
    "narration": { "ja": "幕開けの語り（観客向けの地の文・一〜二文）。行動より前に書くので、夜明け時点で既に真である事実(居場所/天候/霊力/膠着)＋これから問われる緊張(問い)だけで書く。この日の行動・結末は断定しない（NG例:「ハルがナギに語りかける」「応えが返ってくる瞬間」／OK例:「ハルは殻を破れるのか」「ふたりの糸が揺らぐ」。囁きに抗われ嘘になるため）", "en": "the same opening narration in natural casual English (1-2 sentences, same question/stakes, no spoilers; romanize names like Haru/Nagi)" },
    "intent": "演出の狙いを一行で",
    "forageBoosts": [ { "placeId": "場所id", "delta": -8から8の整数 } ],
    "directives": [ { "id": "対象キャラid", "intent": "守護神への指示" } ],
    "spotlightId": "主役のキャラid（${ids.join(" / ")}）",
    "spotlightReason": "主役に選んだ理由を一行で"
  },
  "whispers": [ { "id": "対象キャラid", "whisper": "そのキャラ視点の一人称の囁き" } ],
  "characters": [
    { "id": "キャラid", "action": "...", "moveTarget": "", "targetId": "", "diary": "...", "relationLabel": "...", "paramDeltas": { "altruism": 0, "independence": 0, "trust": 0 }, "deltaReason": "" }
  ],
  "dialogue": [ { "speakerId": "キャラid", "text": "セリフ本文（一文〜二文）" } ]
}`;

  return `=== Day ${state.day} の進行 ===

${directorContext(state, tension, recentLog)}

このあと、生者 ${living.length} 体（${ids.join("・")}）それぞれの判断を、下のキャラ別プロンプトを使って Task サブエージェントに並列で決めさせてください。会話が成立したら会話サブエージェントも。

${subBlocks}

最終的に、次のスキーマの JSON オブジェクトだけを出力してください（characters は生者 ${living.length} 体ぶん、director.weather と spotlightId は必須）:
${schema}`;
}

// ---- 応答パース（部位別フォールバック） ----

function parseTickPlan(raw: string, state: WorldState): TickPlan {
  const living = state.characters.filter((c) => c.alive);
  const validIds = new Set(living.map((c) => c.id));
  const validPlace = new Set(state.places.map((p) => p.id));

  let parsed: Record<string, unknown> = {};
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") parsed = p as Record<string, unknown>;
  } catch (e) {
    // 全体が壊れていても以降のフォールバックで最低限は埋める
    llog("onecall", "⚠parse-failed（全体フォールバック）", {
      chars: raw.length,
      head: raw.slice(0, 80),
    });
  }

  // director
  const d = (parsed.director && typeof parsed.director === "object"
    ? (parsed.director as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const boosts = Array.isArray(d.forageBoosts)
    ? (d.forageBoosts as unknown[])
        .map((b) => {
          const o = (b ?? {}) as Record<string, unknown>;
          return {
            placeId: typeof o.placeId === "string" ? o.placeId : "",
            delta: typeof o.delta === "number" ? Math.round(o.delta) : 0,
          };
        })
        .filter((b) => validPlace.has(b.placeId) && b.delta !== 0)
        .map((b) => ({ placeId: b.placeId, delta: Math.max(-8, Math.min(8, b.delta)) }))
    : [];
  const directives = Array.isArray(d.directives)
    ? (d.directives as unknown[])
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            id: typeof o.id === "string" ? o.id : "",
            intent: typeof o.intent === "string" ? o.intent : "",
          };
        })
        .filter((x) => validIds.has(x.id) && x.intent)
    : [];
  const director: DirectorDecision = {
    weather: d.weather === "lean" ? "lean" : "normal",
    narration: normalizeLocalized(d.narration),
    intent: typeof d.intent === "string" ? d.intent : "",
    forageBoosts: boosts,
    directives,
    spotlightId:
      typeof d.spotlightId === "string" && validIds.has(d.spotlightId)
        ? d.spotlightId
        : living[0]?.id,
    spotlightReason: typeof d.spotlightReason === "string" ? d.spotlightReason : undefined,
  };

  // whispers
  const whispers: GuardianWhisper[] = Array.isArray(parsed.whispers)
    ? (parsed.whispers as unknown[])
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            id: typeof o.id === "string" ? o.id : "",
            whisper: typeof o.whisper === "string" ? o.whisper : "",
          };
        })
        .filter((w) => validIds.has(w.id) && w.whisper)
    : [];

  // characters（欠けは fallback で埋める）
  const arr = Array.isArray(parsed.characters) ? (parsed.characters as unknown[]) : [];
  const byId = new Map<string, CharacterDecision>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    if (!id || !validIds.has(id)) continue;
    const norm = normalizeOne(o, id);
    if (norm) byId.set(id, norm);
  }
  const characters = living.map((c) => byId.get(c.id) ?? fallbackDecision(c.id));
  if (byId.size < living.length) {
    const missing = living.filter((c) => !byId.has(c.id)).map((c) => c.id);
    llog("onecall", "⚠キャラ判断が欠落→フォールバック", { missing: missing.join(",") });
  }

  // dialogue
  const dialogue: DialogueLine[] = Array.isArray(parsed.dialogue)
    ? (parsed.dialogue as unknown[])
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const id = typeof o.speakerId === "string" ? o.speakerId : "";
          const text = typeof o.text === "string" ? o.text.trim() : "";
          const name = living.find((c) => c.id === id)?.name ?? id;
          return { speakerId: id, speakerName: name, text };
        })
        .filter((l) => l.text)
        .slice(0, MAX_DIALOGUE_LINES)
    : [];

  return { director, whispers, decision: { characters }, dialogue };
}

async function runOneCall(
  state: WorldState,
  tension: Tension,
  recentLog: TickResult[],
): Promise<TickPlan> {
  const living = state.characters.filter((c) => c.alive);
  const user = buildOrchestratorUserPrompt(state, tension, recentLog);
  llog("onecall", "tick→orchestrate", {
    day: state.day,
    tension,
    living: living.length,
    ids: living.map((c) => c.id).join(","),
  });
  try {
    const raw = await chatJSON(
      [
        { role: "system", content: ORCHESTRATOR_SYSTEM },
        { role: "user", content: user },
      ],
      { label: "onecall", agentic: true, temperature: 0.9 },
    );
    const plan = parseTickPlan(raw, state);
    llog("onecall", "✓plan", {
      weather: plan.director.weather,
      spotlight: plan.director.spotlightId,
      chars: plan.decision.characters.length,
      whispers: plan.whispers.length,
      boosts: plan.director.forageBoosts.length,
      dialogue: plan.dialogue.length,
    });
    return plan;
  } catch (err) {
    llog("onecall", "✗failed→safe-plan", {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      director: {
        weather: "normal",
        narration: { ja: "", en: "" },
        intent: "",
        forageBoosts: [],
        directives: [],
        spotlightId: living[0]?.id,
      },
      whispers: [],
      decision: { characters: living.map((c) => fallbackDecision(c.id)) },
      dialogue: [],
    };
  }
}

/**
 * onecall バリアントの4プロバイダ（既存型に被せるシム）を作る。
 * director シムが最初に呼ばれた時に1回だけ実コールを撃ち、per-tick の TickPlan を作る。
 * 残りのシムはそのキャッシュから自分の取り分を返す。
 */
export function createOneCallProviders(): {
  decision: DecisionProvider;
  director: DirectorProvider;
  guardian: GuardianProvider;
  dialogue: DialogueProvider;
} {
  let current: TickPlan | null = null;

  const director: DirectorProvider = async (state, tension, recentLog) => {
    current = await runOneCall(state, tension, recentLog);
    return current.director;
  };

  const guardian: GuardianProvider = async () => current?.whispers ?? [];

  const decision: DecisionProvider = async (state) => {
    // 通常は director シムが先に走って current を埋めている。保険として単独でも回す。
    if (!current) {
      llog("onecall", "⚠decision-shim がトリガ（director 未実行）→単独で叩く");
      current = await runOneCall(state, "calm", []);
    }
    return current.decision;
  };

  const dialogue: DialogueProvider = async (_state, _weather, _speakers, history) => {
    const lines = current?.dialogue ?? [];
    const i = history.length;
    if (i >= lines.length) return { text: "", end: true };
    return { text: lines[i].text, end: i + 1 >= lines.length };
  };

  return { decision, director, guardian, dialogue };
}
