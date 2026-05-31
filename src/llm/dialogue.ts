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
      { temperature: 0.9 },
    );

    const parsed = JSON.parse(raw) as unknown;
    const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : "";
    const end = o.end === true;
    return { text, end };
  };
}
