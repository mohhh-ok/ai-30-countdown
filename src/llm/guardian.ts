// 守護神（ガーディアン）。各キャラに「専属」で1体ずつ憑く想定だが、
// claude -p（重い node プロセス）を並列起動するとCPUを食い潰すため、
// 呼び出しは「1回にまとめて直列」で行う（語りは一人ずつ独立に立てる＝専属の見え方は保つ）。
import type { GuardianProvider, GuardianWhisper, WorldState } from "../domain/types.ts";
import { temperamentText } from "../domain/rules.ts";
import { findPlace } from "../domain/places.ts";
import { chatJSON } from "./backend.ts";

const SYSTEM_PROMPT = `あなたは、登場人物それぞれに「専属で1体ずつ」憑く守護神たちの声をまとめて綴ります。
各守護神が見守るのは自分の担当ただ一人。その者の心の奥に、本人の一人称の声としてささやきます。

役割:
- 演出家から「この者をこう動かしたい」という指示を受け取る。あなたはそれを、その人物自身の内なる声・直感・衝動・良心のささやきに変換する。
- 命令口調にしない。本人の心からこぼれ出た声のように。背中をそっと押す、迷いを言葉にする、欲求を自覚させる。
- その人物の「芯」と「いまの気分」に根ざした言葉にする。芯に反することは無理強いしない（強いても本人が抗う）。
- whisper は本人の内なる声なので、その者の「固定口調」に合わせて全振りで“pop”に（タメ口・軽快、記号や絵文字も可）。古めかしい言い回しは使わない。
- 一人ずつ独立に。他者の事情を混ぜない。短く、生々しく、一〜二文。

必ず指定の JSON だけを出力すること。`;

export function createGuardianProvider(): GuardianProvider {
  return async (state: WorldState, directives) => {
    if (directives.length === 0) return [];

    const block = directives
      .map((d) => {
        const c = state.characters.find((x) => x.id === d.id);
        if (!c) return "";
        const t = temperamentText(c.params);
        const place = findPlace(state.places, c.currentPlaceId)?.name ?? c.currentPlaceId;
        const lastDiary = c.diary.length ? c.diary[c.diary.length - 1] : "（なし）";
        return `### ${c.name}（id: ${c.id}）— この者の専属守護神として
芯: ${c.core}
固定口調（囁きはこの喋り方で）: ${c.voice}
今の気分: 高揚${c.mood.elation}/温${c.mood.warmth}/安${c.mood.calm}/ストレス${c.mood.stress}
気質: 利他=${t.altruism} / 自立=${t.independence} / 信頼=${t.trust}
現在地: ${place} ｜ 霊力: ${c.energy} ｜ 胸の内: 「${lastDiary}」
演出家からの指示（この者をどう動かしたいか）: ${d.intent}`;
      })
      .filter(Boolean)
      .join("\n\n");

    const idList = directives.map((d) => `"${d.id}"`).join(" / ");
    const userPrompt = `次の人物それぞれに、その専属の守護神としてささやいてください。各人は独立に、その者の芯と気分だけに根ざして。

${block}

それぞれの演出家の指示を、その人物の芯と気分に根ざした「内なる声」に変えること。命令でなく、本人の心の声として。

次の JSON だけを出力:
{
  "whispers": [
    { "id": "対象id（${idList}）", "whisper": "心にささやく一人称の声（一〜二文）" }
  ]
}`;

    const raw = await chatJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.9, label: "guardian" },
    );

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const valid = new Set(directives.map((d) => d.id));
    const arr = Array.isArray(parsed.whispers) ? (parsed.whispers as unknown[]) : [];
    const out: GuardianWhisper[] = arr
      .map((w) => {
        const o = w as Record<string, unknown>;
        return {
          id: typeof o.id === "string" ? o.id : "",
          whisper: typeof o.whisper === "string" ? o.whisper : "",
        };
      })
      .filter((w) => valid.has(w.id) && w.whisper);
    return out;
  };
}
