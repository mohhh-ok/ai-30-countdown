// 演出家(director)＋守護神(guardian)を「1コール」に統合した特殊プロバイダ。
//
// 背景:
//  - 1ティックは director → guardian → decide → dialogue の逐次フェーズ。各フェーズが
//    遅い claude -p 1コール（~30-40秒）なので、フェーズ数がそのまま wall-clock を押し上げる。
//  - director と guardian は「どちらも全体に1回・前者の directives を後者が一人称の囁きに翻訳」
//    という素直な依存。ここを1コールに畳めば逐次段が1つ減る（キャラ並列の decide は別途維持）。
//  - guardian を decide 側に畳まないのは: (1) エンジンの「衝動」機構が whispers を decide より
//    前に必要とする、(2) 囁きは「外から憑く独立した声」で、本人が従う/抗うの緊張を保つため。
//
// 実装はアダプタ（runTick 無改造）: director シムが最初に呼ばれた時に1回だけ実コールを撃ち、
// DirectorDecision と whispers をまとめて作って per-tick キャッシュに置く。guardian シムは
// そのキャッシュの whispers を返すだけ。env を切れば（配線側で）従来の2プロバイダに戻せる。
import type {
  DirectorDecision,
  DirectorProvider,
  GuardianProvider,
  GuardianWhisper,
  Tension,
  TickResult,
  WorldState,
} from "../domain/types.ts";
import { findPlace } from "../domain/places.ts";
import { temperamentText } from "../domain/rules.ts";
import { chatJSON } from "./backend.ts";
import { llog } from "./log.ts";

const SYSTEM_PROMPT = `あなたは、ある小さな世界を見守る「演出家」であり、同時に登場人物それぞれに憑く「守護神」たちでもあります。観客（読者）がこの物語に飽きないよう、舞台＝環境に介入し、各人の心に一人称の声をささやきます。

演出家としての絶対の制約:
- 登場人物の芯・性格・行動・感情を直接操作してはいけない。動かせるのは環境だけ。
- できるのは「天候を決める」「場所の実り（食料）を一時的に増減させる」「幕開けの情景を語る」こと。
- ご都合主義で救いすぎない／いじめすぎない。緊張と緩和のリズムを作る。

演出の方針（緊張度に応じて）:
- calm（平穏）: 小さなさざ波を立てる。退屈の一歩手前で何かを仕込む。
- stagnant（膠着・退屈）: 状況を必ず揺さぶる。天候を変えるか forageBoosts で実りを動かし、現実に変化を起こす。
- tense（緊迫）: 緊張を活かす。安易に緩めない。
- tragic（悲劇が近い）: 猶予を与えて見せ場を作るか、あえて追い打ちか、ドラマとして最も映える方を選ぶ。

出会いの誘発:
- 登場人物が別々の場所にいて何日も出会えていないなら致命的な停滞。forageBoosts で出会いを誘発せよ
  （誰もいない側の実りを下げ留まる理由を奪う／相手がいる側を上げ引き寄せる）。

カメラ（主役・spotlightId）:
- 群像劇だが観客が見るのは「今いちばん物語が動く一人」。葛藤・危機・決断・出会い・裏切りが宿る人物を選ぶ。
- 原則として前回の主役とは別人を選び、視点を日ごとに移す（退場寸前など、どうしても必要な時のみ続投可）。

守護神としての役割（directives と whispers）:
- 各登場人物には「専属で1体ずつ」守護神が憑く。あなたは演出家として「この者をどう動かしたいか」を directives に書き、
  同時にその守護神として、それを **本人の芯と今の気分に根ざした一人称の内なる声(whisper)** に翻訳する。
- 命令口調にしない（背中をそっと押す／迷いを言葉にする／欲求を自覚させる）。芯に反する強制はしない（強いても本人は抗う）。
- whisper は本人の内なる声なので、その者の「固定口調」に合わせて全振りで“pop”に（タメ口・軽快、記号や絵文字も可）。古めかしい言い回しは使わない。
- directive を与えた各キャラには必ず対応する whisper を作る。囁きが「演出家の見たい絵」を体現するようにする。
- 介入が要らないキャラには directive も whisper も付けなくてよい。

ナレーションは観客向けの地の文。トーンは全振りで“pop”に：実況・煽り系のノリで軽快に短く、情景と次への引きを込めて（例:「霊力ガス欠寸前!?今日のサバイバルやいかに〜！」）。古めかしい言い回しは使わず、感嘆符や「!?」「〜」も気軽に。
必ず指定の JSON だけを出力し、説明文を付けないこと。`;

const TENSION_LABEL: Record<Tension, string> = {
  calm: "平穏（大きな波がなく、やや退屈になりかけ）",
  stagnant: "膠着（同じ行動の繰り返しで物語が停滞）",
  tense: "緊迫（葛藤や危機が高まっている）",
  tragic: "悲劇接近（誰かが力尽きる寸前）",
};

interface DirGuardPlan {
  director: DirectorDecision;
  whispers: GuardianWhisper[];
}

function buildUserPrompt(state: WorldState, tension: Tension, recentLog: TickResult[]): string {
  const living = state.characters.filter((c) => c.alive);
  const cast = living
    .map((c) => {
      const place = findPlace(state.places, c.currentPlaceId)?.name ?? c.currentPlaceId;
      const t = temperamentText(c.params);
      const lastDiary = c.diary.length ? c.diary[c.diary.length - 1] : "（なし）";
      return `- ${c.name}(id:${c.id}): 霊力${c.energy} @${place} ｜ 気分(高揚${c.mood.elation}/温${c.mood.warmth}/安${c.mood.calm}/ストレス${c.mood.stress}) ｜ 気質 利他=${t.altruism}/自立=${t.independence}/信頼=${t.trust} ｜ 相手への感情:${c.relationLabel} ｜ 胸の内:「${lastDiary}」｜ 固定口調(囁きはこの喋り方で): ${c.voice}`;
    })
    .join("\n");

  const placeList = state.places
    .map(
      (p) =>
        `  - "${p.id}"（${p.name}）民の霊力 清${p.populace.sei}/濁${p.populace.daku}（頂ける上限${p.forage.normal}）`,
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
  const sepNote = separated
    ? "※ 登場人物は今、別々の場所にいて出会えていない。続くなら出会いを誘発する介入を強く検討すること。"
    : "※ 登場人物は同じ場所にいる。";

  const prevSpotId = recentLog.length ? recentLog[recentLog.length - 1].spotlightId : undefined;
  const prevSpotName = prevSpotId
    ? state.characters.find((c) => c.id === prevSpotId)?.name ?? prevSpotId
    : "（まだない）";

  const ids = living.map((c) => c.id);
  return `現在 Day ${state.day} を迎えようとしています。
緊張度: ${TENSION_LABEL[tension]}
${sepNote}
前回カメラを向けた主役: ${prevSpotName}

登場人物:
${cast}

直近の流れ:
${recent}

場所（実りを一時操作できる。id 指定）:
${placeList}

この緊張度を踏まえ、観客が次の一日を見たくなるよう環境を演出し、動かしたい者には守護神の囁きを添えてください。
次の JSON だけを出力:
{
  "weather": "normal | lean のいずれか",
  "narration": "幕開けの語り（観客向けの地の文・一〜二文）",
  "intent": "この演出の狙いを一行で（メタ・記録用）",
  "forageBoosts": [ { "placeId": "場所id", "delta": -8から8までの整数(符号は付けない。例 5 や -3) } ],
  "directives": [ { "id": "${ids.join(" か ")}", "intent": "守護神への指示・どう動かしたいか" } ],
  "whispers": [ { "id": "対象キャラid（directives と対応）", "whisper": "その者の芯と気分に根ざした一人称の内なる声（一〜二文）" } ],
  "spotlightId": "今カメラを向ける主役の id（${ids.join(" / ")}）。最も物語が動く視点を選ぶ",
  "spotlightReason": "その人物を主役にする理由を一行で"
}
forageBoosts・directives・whispers は介入しないなら空配列で構いません。spotlightId は必ず1人選ぶこと。
directive を出した者には、必ず対応する whisper を入れること。`;
}

function parsePlan(raw: string, state: WorldState): DirGuardPlan {
  const living = state.characters.filter((c) => c.alive);
  const validIds = new Set(living.map((c) => c.id));
  const validPlace = new Set(state.places.map((p) => p.id));

  let parsed: Record<string, unknown> = {};
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") parsed = p as Record<string, unknown>;
  } catch {
    llog("dirguard", "⚠parse-failed（フォールバック）", { head: raw.slice(0, 80) });
  }

  const boosts = Array.isArray(parsed.forageBoosts)
    ? (parsed.forageBoosts as unknown[])
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

  const directives = Array.isArray(parsed.directives)
    ? (parsed.directives as unknown[])
        .map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return {
            id: typeof o.id === "string" ? o.id : "",
            intent: typeof o.intent === "string" ? o.intent : "",
          };
        })
        .filter((d) => validIds.has(d.id) && d.intent)
    : [];

  const whispers: GuardianWhisper[] = Array.isArray(parsed.whispers)
    ? (parsed.whispers as unknown[])
        .map((w) => {
          const o = (w ?? {}) as Record<string, unknown>;
          return {
            id: typeof o.id === "string" ? o.id : "",
            whisper: typeof o.whisper === "string" ? o.whisper : "",
          };
        })
        .filter((w) => validIds.has(w.id) && w.whisper)
    : [];

  const director: DirectorDecision = {
    weather: parsed.weather === "lean" ? "lean" : "normal",
    narration: typeof parsed.narration === "string" ? parsed.narration : "",
    intent: typeof parsed.intent === "string" ? parsed.intent : "",
    forageBoosts: boosts,
    directives,
    spotlightId:
      typeof parsed.spotlightId === "string" && validIds.has(parsed.spotlightId)
        ? parsed.spotlightId
        : living[0]?.id,
    spotlightReason:
      typeof parsed.spotlightReason === "string" ? parsed.spotlightReason : undefined,
  };

  return { director, whispers };
}

async function runDirGuard(
  state: WorldState,
  tension: Tension,
  recentLog: TickResult[],
): Promise<DirGuardPlan> {
  try {
    const raw = await chatJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(state, tension, recentLog) },
      ],
      { temperature: 0.95, label: "director+guardian" },
    );
    const plan = parsePlan(raw, state);
    llog("dirguard", "✓plan", {
      weather: plan.director.weather,
      spotlight: plan.director.spotlightId,
      directives: plan.director.directives.length,
      whispers: plan.whispers.length,
      boosts: plan.director.forageBoosts.length,
    });
    return plan;
  } catch (err) {
    llog("dirguard", "✗failed→safe-plan", {
      err: err instanceof Error ? err.message : String(err),
    });
    const living = state.characters.filter((c) => c.alive);
    return {
      director: {
        weather: "normal",
        narration: "",
        intent: "",
        forageBoosts: [],
        directives: [],
        spotlightId: living[0]?.id,
      },
      whispers: [],
    };
  }
}

/**
 * director＋guardian を1コールに統合した {director, guardian} シムを作る。
 * director シムが実コールを撃って per-tick キャッシュを埋め、guardian シムは whispers を返すだけ。
 * runTick は無改造（既存の DirectorProvider / GuardianProvider 型に被せる）。
 */
export function createDirectorGuardianProviders(): {
  director: DirectorProvider;
  guardian: GuardianProvider;
} {
  let current: DirGuardPlan | null = null;

  const director: DirectorProvider = async (state, tension, recentLog) => {
    current = await runDirGuard(state, tension, recentLog);
    return current.director;
  };

  // guardian は engine が directives>0 のときだけ呼ぶ。director シムが直前に埋めた whispers を返す。
  const guardian: GuardianProvider = async () => current?.whispers ?? [];

  return { director, guardian };
}
