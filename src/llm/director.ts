// 演出家（ディレクター）。物語がエンタメとして面白くなるよう、環境にだけ介入する。
// キャラの芯・行動・自由意志には一切触れない。天候・場所の実り・幕開けの語りを決める。
import type {
  DirectorProvider,
  Tension,
  TickResult,
  WorldState,
} from "../domain/types.ts";
import { findPlace } from "../domain/places.ts";
import { eventBlurb, eventLabel } from "../domain/events.ts";
import { chatJSON, normalizeLocalized } from "./backend.ts";

const SYSTEM_PROMPT = `あなたは、ある小さな世界を見守る「演出家」です。観客（読者）がこの物語に飽きないよう、舞台＝環境に介入します。

絶対の制約:
- 登場人物の芯・性格・行動・感情を直接操作してはいけない。あなたが動かせるのは環境だけ。
- できるのは「天候を決める」「場所の実り（食料）を一時的に増減させる」「幕開けの情景を語る」こと。
- ご都合主義で救いすぎない／いじめすぎない。緊張と緩和のリズムを作る。

演出の方針（緊張度に応じて）:
- calm（平穏）: 小さなさざ波を立てる。退屈の一歩手前で何かを仕込む。
- stagnant（膠着・退屈）: 状況を必ず揺さぶる。ナレーションを書くだけで終わらせてはいけない。天候を変えるか、forageBoosts で場所の実りを動かして、現実に変化を起こすこと。
- tense（緊迫）: 緊張を活かす。安易に緩めない。
- tragic（悲劇が近い）: ここぞの局面。猶予を与えて見せ場を作るか、あえて追い打ちをかけるか、ドラマとして最も映える方を選ぶ。

最重要・出会いの誘発:
- 登場人物が別々の場所にいて何日も出会えていないなら、それは物語の致命的な停滞だ。傍観してはいけない。
- forageBoosts を積極的に使って出会いを誘発せよ。例:
  - 誰もいない側の場所の実りを大きく下げて（−5〜−8）、そこに留まる理由を奪い、移動を促す。
  - 相手がいる場所の実りを上げて（+4〜+8）、引き寄せる誘因を作る。

守護神への指示（directives）— あなたの最も強力な手段:
- 各登場人物には「守護神」が憑いており、あなたの指示を受けてその者の心にささやく。
- あなたはキャラの行動を直接操作できないが、守護神に「この者をどう動かしたいか」を伝えられる。
- 動かしたい人物には directives で意図を書く（例: "孤独に耐えかね、ハルに会いに動き出してほしい"）。環境(forageBoosts)と囁き(directives)を組み合わせて、停滞を破れ。

カメラ（主役の選択・spotlightId）:
- これは群像劇だが、観客が見るのは「今この瞬間、最も物語が動いている一人」の視点だ。あなたはカメラを誰に向けるかを毎日選ぶ。
- 葛藤・危機・決断・出会い・裏切りなど、いちばんドラマが宿る人物を主役に選ぶ。
- 原則として、前回カメラを向けた主役とは「別の人物」を選ぶこと。視点は日ごとに移し、群像を順に見せる。漫然と同じ人物を映し続けて飽きさせない。（例外: 前回の主役が今まさに退場寸前など、どうしてもその人物の場面が要るときのみ続投可）
- 主役が力尽きて退場したら、カメラは残った者の中で最も目が離せない者へ移る。こうして物語は途切れず続く。

天変地異（災い/恵み）について:
- 京には時折「大飢饉・疫病・長雨・豊穣」といった天変地異が、あなたの手とは別に天から降りかかる（数日続く）。
- これらは環境として既に効いている（実り・霊力・消耗に反映済み）。あなたはそれを覆す力はないが、幕開けの語りに織り込み、守護神への指示や実り操作を災いに合わせて研ぎ澄ますこと。
- 飢饉のさなかなら、それは登場人物を死に近づける好機でもあり、絆や禁忌が試される局面でもある。ドラマとして最も映えるよう活かせ。

ナレーションは観客に向けた地の文。トーンは全振りで“pop”に：実況・煽り系のノリで軽快に、短く、情景と次への引きを込めて（例:「霊力ガス欠寸前!?今日のサバイバルやいかに〜！」）。古めかしい言い回しは使わず、感嘆符や「!?」「〜」も気軽に。可能なら主役の視点に寄り添う。
ナレーション（narration）は日本語(ja)と英語(en)の両方を必ず書くこと。英語は日本語の直訳ではなく、同じ場面・同じ煽りを英語ネイティブ向けに自然な口語・実況トーンで書く（casual, punchy, present-tense play-by-play）。固有名（ハル/ナギ等）は英語側では Haru/Nagi のようにローマ字表記にする。
必ず指定の JSON だけを出力し、説明文を付けないこと。`;

const TENSION_LABEL: Record<Tension, string> = {
  calm: "平穏（大きな波がなく、やや退屈になりかけ）",
  stagnant: "膠着（同じ行動の繰り返しで物語が停滞）",
  tense: "緊迫（葛藤や危機が高まっている）",
  tragic: "悲劇接近（誰かが力尽きる寸前）",
};

export function createDirectorProvider(): DirectorProvider {
  return async (state: WorldState, tension: Tension, recentLog: TickResult[]) => {
    const living = state.characters.filter((c) => c.alive);
    const cast = living
      .map((c) => {
        const place = findPlace(state.places, c.currentPlaceId)?.name ?? c.currentPlaceId;
        return `- ${c.name}: 霊力${c.energy} @${place} ｜ 気分(高揚${c.mood.elation}/温${c.mood.warmth}/安${c.mood.calm}/ストレス${c.mood.stress}) ｜ 相手への感情:${c.relationLabel.ja}`;
      })
      .join("\n");

    const placeList = state.places
      .map(
        (p) =>
          `  - "${p.id}"（${p.name}）民の霊力 和み${p.populace.sei}/荒び${p.populace.daku}（頂ける上限${p.forage.normal}）`,
      )
      .join("\n");

    const recent = recentLog
      .slice(-3)
      .map((t) => {
        const acts = t.characters.map((c) => `${c.name}=${c.actionLabel}`).join("/");
        return `  Day${t.day}[${t.weather === "normal" ? "通常" : "不作"}] ${acts}`;
      })
      .join("\n") || "  （まだない）";

    const places = new Set(living.map((c) => c.currentPlaceId));
    const separated = living.length >= 2 && places.size > 1;
    const soloName = living[0]?.name ?? "主人公";
    const separationNote =
      living.length === 1
        ? `※ 今、京にいる妖は ${soloName} 独りだけ。ほかに妖はいない。ナレーションでも囁きでも「三人」「二人」「仲間」「あの者たち」など他者の存在を一切匂わせないこと（独りであることが今この物語の事実）。`
        : separated
          ? `※ 登場人物は今、別々の場所にいて出会えていない。これが続くなら出会いを誘発する介入を強く検討すること。`
          : `※ 登場人物は同じ場所にいる。`;

    const prevSpotId = recentLog.length
      ? recentLog[recentLog.length - 1].spotlightId
      : undefined;
    const prevSpotName = prevSpotId
      ? state.characters.find((c) => c.id === prevSpotId)?.name ?? prevSpotId
      : "（まだない）";

    const eventNote =
      state.activeEvents.length > 0
        ? state.activeEvents
            .map((e) => `  - ${eventLabel(e)}：${eventBlurb(e.kind)}`)
            .join("\n")
        : "  （なし。京は穏やか）";

    const userPrompt = `現在 Day ${state.day} を迎えようとしています。
緊張度: ${TENSION_LABEL[tension]}
${separationNote}
前回カメラを向けた主役: ${prevSpotName}

いま京に起きている天変地異（あなたの手の外。既に環境へ反映済み）:
${eventNote}

登場人物:
${cast}

直近の流れ:
${recent}

場所（実りを一時操作できる。id 指定）:
${placeList}

この緊張度を踏まえ、観客が次の一日を見たくなるよう環境を演出してください。
次の JSON だけを出力:
{
  "weather": "normal | lean のいずれか",
  "narration": { "ja": "幕開けの語り（観客向けの地の文・一〜二文）", "en": "the same opening narration in natural casual English (1-2 sentences)" },
  "intent": "この演出の狙いを一行で（メタ・記録用）",
  "forageBoosts": [ { "placeId": "場所id", "delta": -8から8までの整数(符号は付けない。例 5 や -3) } ],
  "directives": [ { "id": "${living.map((c) => c.id).join(" か ")}", "intent": "守護神への指示・どう動かしたいか" } ],
  "spotlightId": "今カメラを向ける主役の id（${living.map((c) => c.id).join(" / ")}）。最も物語が動く視点を選ぶ",
  "spotlightReason": "その人物を主役にする理由を一行で"
}
forageBoosts・directives は介入しないなら空配列で構いません。spotlightId は必ず1人選ぶこと。`;

    const raw = await chatJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.95, label: "director" },
    );

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const weather = parsed.weather === "lean" ? "lean" : "normal";
    const validPlace = new Set(state.places.map((p) => p.id));
    const boosts = Array.isArray(parsed.forageBoosts)
      ? (parsed.forageBoosts as unknown[])
          .map((b) => {
            const o = b as Record<string, unknown>;
            return {
              placeId: typeof o.placeId === "string" ? o.placeId : "",
              delta: typeof o.delta === "number" ? Math.round(o.delta) : 0,
            };
          })
          .filter((b) => validPlace.has(b.placeId) && b.delta !== 0)
          .map((b) => ({ placeId: b.placeId, delta: Math.max(-8, Math.min(8, b.delta)) }))
      : [];

    const validIds = new Set(living.map((c) => c.id));
    const directives = Array.isArray(parsed.directives)
      ? (parsed.directives as unknown[])
          .map((d) => {
            const o = d as Record<string, unknown>;
            return {
              id: typeof o.id === "string" ? o.id : "",
              intent: typeof o.intent === "string" ? o.intent : "",
            };
          })
          .filter((d) => validIds.has(d.id) && d.intent)
      : [];

    const spotlightId =
      typeof parsed.spotlightId === "string" && validIds.has(parsed.spotlightId)
        ? parsed.spotlightId
        : undefined;

    // narration は {ja,en} で受け取る。万一モデルが旧形（素の string）を返したら ja に寄せ、
    // en は空のまま残す（黙って ja で埋めず、UI 側で warn 可視化＋日本語フォールバックさせる）。
    const narration = normalizeLocalized(parsed.narration);

    return {
      weather,
      narration,
      intent: typeof parsed.intent === "string" ? parsed.intent : "",
      forageBoosts: boosts,
      directives,
      spotlightId,
      spotlightReason:
        typeof parsed.spotlightReason === "string" ? parsed.spotlightReason : undefined,
    };
  };
}
