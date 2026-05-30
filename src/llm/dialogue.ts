// 「語りかける」が成立した日の、短い会話（セリフのやり取り）を生成する。
import type {
  Character,
  DialogueProvider,
  DialogueSpeaker,
  WorldState,
  Weather,
} from "../domain/types.ts";
import { ACTION_LABELS } from "../domain/types.ts";
import { temperamentText } from "../domain/rules.ts";
import { findPlace } from "../domain/places.ts";
import { chatJSON } from "./backend.ts";

const SYSTEM_PROMPT = `あなたは2人の登場人物の短い会話を脚本として書きます。
- 各人の「芯」と「いまの気質」「相手への感情」がにじむ、自然で具体的な口語のセリフにする。
- 2〜4往復（合計4〜6発言）程度の短いやり取り。だらだら続けない。
- 地の文・ト書き・説明は書かない。セリフ本文だけ。
- 口調は人物ごとに変える。指定された話し手だけが喋る。
- 今日それぞれが取った行動と矛盾しない会話にする（採取で忙しい相手はそっけない等）。
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
  ) => {
    const chars = speakers
      .map((s) => state.characters.find((c) => c.id === s.id))
      .filter((c): c is Character => !!c);
    if (chars.length < 2) return [];

    const place = findPlace(state.places, chars[0].currentPlaceId)?.name ?? "";
    const profiles = speakers
      .map((s) => {
        const c = state.characters.find((x) => x.id === s.id)!;
        return speakerProfile(c, ACTION_LABELS[s.action], state.places);
      })
      .join("\n\n");

    const firstSpeaker = chars[0]; // 話しかけた側が口火を切る
    const idList = chars.map((c) => `"${c.id}"`).join(" / ");

    const userPrompt = `舞台: ${place}（天候: ${weather === "normal" ? "通常日" : "不作日"}）
${firstSpeaker.name} が相手に語りかけた。次の2人の短い会話を書いてください。

${profiles}

口火は ${firstSpeaker.name} が切る。それぞれの芯と感情がにじむ、短く自然な会話にしてください。

次の JSON スキーマだけを出力:
{
  "dialogue": [
    { "speaker": "発言者の id（${idList}）", "text": "セリフ本文（一文〜二文）" }
  ]
}`;

    const raw = await chatJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.9 },
    );

    const parsed = JSON.parse(raw) as unknown;
    const arr =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).dialogue)
        ? ((parsed as any).dialogue as unknown[])
        : [];
    const out: { speaker: string; text: string }[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.speaker === "string" && typeof o.text === "string") {
        out.push({ speaker: o.speaker, text: o.text });
      }
    }
    return out;
  };
}
