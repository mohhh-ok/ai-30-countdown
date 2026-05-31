// 「語りかける」が成立した日の会話劇を、一発言ずつ生成する（会話の1シーン化）。
// エンジンが話し手を交代させながら何度も呼び、これまでの応酬を踏まえた次の一言を返す。
import type {
  Character,
  DialogueLine,
  DialogueProvider,
  DialogueSpeaker,
  WorldState,
  Weather,
} from "../domain/types.ts";
import { ACTION_LABELS } from "../domain/types.ts";
import { temperamentText } from "../domain/rules.ts";
import { findPlace } from "../domain/places.ts";
import { chatJSON } from "./backend.ts";
import { llog } from "./log.ts";

const SYSTEM_PROMPT = `あなたは2人の登場人物の会話劇を、一発言ずつ脚本として書きます。
- 指定された「次の話し手」になりきり、これまでの会話の流れに自然に応える一言を返す。
- 各人の「芯」と「いまの気質」「相手への感情」がにじむ、自然で具体的な口語のセリフにする。
- 一度に書くのは一発言だけ（一文〜二文）。だらだら何往復も書かない。
- 地の文・ト書き・説明は書かない。セリフ本文だけ。
- 口調は人物ごとに変える。指定された話し手だけが喋る。
- 今日それぞれが取った行動と矛盾しない会話にする（採取で忙しい相手はそっけない等）。
- 話が尽きた／立ち去る／気まずく途切れる など、ここで会話を締めるのが自然なら end を true にする。
必ず指定された JSON スキーマだけを出力し、前後に説明を付けないこと。`;

function speakerProfile(c: Character, action: string, places: WorldState["places"]): string {
  const t = temperamentText(c.params);
  const place = findPlace(places, c.currentPlaceId)?.name ?? c.currentPlaceId;
  const lastDiary = c.diary.length ? c.diary[c.diary.length - 1] : "（なし）";
  return `### ${c.name}（id: ${c.id}）
芯: ${c.core}
今日の行動: ${action}
気質: 利他=${t.altruism} / 自立=${t.independence} / 信頼=${t.trust}
相手への感情: ${c.relationLabel}
いまの胸の内: 「${lastDiary}」
現在地: ${place} ｜ エネルギー: ${c.energy}`;
}

export function createDialogueProvider(): DialogueProvider {
  return async (
    state: WorldState,
    weather: Weather,
    speakers: DialogueSpeaker[],
    history: DialogueLine[],
    nextSpeakerId: string,
  ) => {
    const next = state.characters.find((c) => c.id === nextSpeakerId);
    if (!next) return { text: "", end: true };

    const place = findPlace(state.places, next.currentPlaceId)?.name ?? "";
    const profiles = speakers
      .map((s) => {
        const c = state.characters.find((x) => x.id === s.id)!;
        return speakerProfile(c, ACTION_LABELS[s.action], state.places);
      })
      .join("\n\n");

    const transcript =
      history.length > 0
        ? history.map((l) => `${l.speakerName}: 「${l.text}」`).join("\n")
        : "（まだ誰も口を開いていない）";

    const userPrompt = `舞台: ${place}（天候: ${weather === "normal" ? "通常日" : "不作日"}）

${profiles}

これまでの会話:
${transcript}

次に「${next.name}（id: ${next.id}）」が話す番です。${
      history.length === 0 ? `${next.name} が相手に語りかけ、口火を切ります。` : ""
    }芯と相手への感情がにじむ、短く自然な次の一言を書いてください。会話をここで締めるのが自然なら end を true に。

次の JSON スキーマだけを出力:
{ "text": "セリフ本文（一文〜二文）", "end": false }`;

    const raw = await chatJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.9, label: "dialogue" },
    );

    const parsed = JSON.parse(raw) as unknown;
    const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : "";
    const end = o.end === true;
    return { text, end };
  };
}

// ============================================================
// 一括生成版（M往復 → 1コール）
// 会話劇は本来「一発言ずつ」逐次生成するが、claude -p は1コール ~30-40秒のため
// 往復ぶんだけ逐次コールすると数分かかる（最大のボトルネック）。
// そこで初回（history が空）に会話全文を1コールで生成してキャッシュし、以降はターンごとに
// 配るだけにする。runTick の会話ループは無改造のまま、コール数を 1 に畳む。
// ============================================================

const MIN_LINES = 4; // 最低でもこのくらいは応酬させたい
const MAX_LINES = 8; // 暴走防止の上限（engine の MAX_TURNS とも整合）

const ONESHOT_SYSTEM = `あなたは2人の登場人物の会話劇を、最初から最後まで一気に脚本として書きます。
- 2人が交互に短く言葉を交わす（各セリフは一文〜二文）。地の文・ト書き・説明は書かない。
- 最初に話すのは「口火を切る側（指定する）」。以後その2人で交互に。
- 各人の「芯」「いまの気質」「相手への感情」「今日の行動」がにじむ、自然で具体的な口語に。口調は人物ごとに変える。
- 全体で ${MIN_LINES}〜${MAX_LINES} 発言ほど。話が自然に締まるところで終える（無理に伸ばさない）。
- 今日それぞれが取った行動と矛盾しない会話にする。
必ず指定の JSON スキーマだけを出力し、前後に説明を付けないこと。`;

/**
 * 会話を1コールで全文生成するプロバイダ（既存 DialogueProvider 型に被せるアダプタ）。
 * - history が空の初回に全文を生成してキャッシュ（話す順 = 口火を切る側→相手→…）。
 * - 以降の呼び出しは history.length をインデックスにして、キャッシュした行を1つずつ返す。
 * - engine は話者を order[turn%2] で交互に割り当てるので、生成順（口火側始まりの交互）と一致する。
 */
export function createOneShotDialogueProvider(): DialogueProvider {
  let lines: string[] = [];

  async function generate(
    state: WorldState,
    weather: Weather,
    speakers: DialogueSpeaker[],
  ): Promise<string[]> {
    if (speakers.length < 2) return [];
    const [a, b] = speakers;
    const ca = state.characters.find((c) => c.id === a.id);
    const cb = state.characters.find((c) => c.id === b.id);
    if (!ca || !cb) return [];

    const place = findPlace(state.places, ca.currentPlaceId)?.name ?? "";
    const profiles = [a, b]
      .map((s) => {
        const c = state.characters.find((x) => x.id === s.id)!;
        return speakerProfile(c, ACTION_LABELS[s.action], state.places);
      })
      .join("\n\n");

    const userPrompt = `舞台: ${place}（天候: ${weather === "normal" ? "通常日" : "不作日"}）

${profiles}

口火を切るのは「${ca.name}（id: ${ca.id}）」。${ca.name} が ${cb.name} に語りかけ、以後この2人で交互に短く言葉を交わします。
芯と相手への感情がにじむ、自然な会話劇を最初から最後まで書いてください。

次の JSON だけを出力（speaker は ${ca.name}→${cb.name}→… の交互。${MIN_LINES}〜${MAX_LINES} 発言）:
{ "lines": ["口火（${ca.name}）のセリフ", "${cb.name} の返し", "..."] }`;

    const raw = await chatJSON(
      [
        { role: "system", content: ONESHOT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.9, label: "dialogue:oneshot" },
    );

    let out: string[] = [];
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(parsed.lines)) {
        out = (parsed.lines as unknown[])
          .map((l) => (typeof l === "string" ? l.trim() : ""))
          .filter(Boolean)
          .slice(0, MAX_LINES);
      }
    } catch {
      llog("dialogue", "⚠oneshot parse-failed", { head: raw.slice(0, 80) });
    }
    llog("dialogue", "✓oneshot", { lines: out.length });
    return out;
  }

  return async (state, weather, speakers, history) => {
    // 初回（history 空）に全文生成。以降はキャッシュから1行ずつ。
    if (history.length === 0) lines = await generate(state, weather, speakers);
    const i = history.length;
    if (i >= lines.length) return { text: "", end: true };
    return { text: lines[i], end: i + 1 >= lines.length };
  };
}
