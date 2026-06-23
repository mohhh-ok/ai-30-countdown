// LLM へのプロンプト生成。
// 数値は出さず「翻訳した気質の言葉」を本人の判断材料にする（plan.md 第6節）。
// 場所（京都）と移動、直近行動の偏りも判断材料として渡す。
import type {
  Character,
  HeroContext,
  Place,
  WorldState,
  Weather,
} from "../domain/types.ts";
import { ACTION_LABELS, FORBIDDEN_ACTIONS } from "../domain/types.ts";
import { temperamentText } from "../domain/rules.ts";
import { findPlace } from "../domain/places.ts";
import { findSkill } from "../domain/skills.ts";
import { soulBlock } from "../domain/soul.ts";

export const SYSTEM_PROMPT = `あなたは「妖の京（あやかしのみやこ）」の進行を司るエンジン兼ナレーターです。
神と妖の棲む、もうひとつの京都。世を巡る霊力が痩せ細り、人ならぬ者たちが、わずかな民の霊力を巡って生きている。
複数の妖それぞれの「芯」と「いまの気質」「異能」、記憶、置かれた霊地と状況から、各人がこの1日に取る行動を1つずつ選びます。

この世界の霊力（用語。地の文・日記でもこの語を使うこと）:
- 民の霊力には二つの相がある。「和み」＝澄んだ和やぎの気。「荒び」＝人の欲・念・猛りの気。
- 荒びは穢れでも悪でもない。神の荒ぶる面であり、鎮めれば和みへと和らぐ。ゆえに霊地（とりわけ実在の社）を「穢れた地」「汚れ」などと貶める言い方はしないこと。荒びの濃い地は「猛き神威の地」と捉える。
- 集霊では和みを穏当に頂ける。喰らう者は荒びを好んで喰らう。「祓い清める」は、猛った荒びを鎮め、和みへ和らげる利他の行い。

重要な原則:
- 各人の「芯（不変の価値観）」は絶対に曲げない。変わるのは芯と現実の折り合いのつけ方だけ。
- 全体の目標は無い。各人はただ生き延びる（霊力を絶やさない）必要があるだけ。何を大切にするかは芯と気質から自分で決める。
- 霊力の消耗（毎日すり減る負荷）があるからこそ、協調・対立・葛藤・成長が生まれる。
- 集霊（霊を集める）は、その霊地に残る「民の霊力」を頂く行為。和みは穏当に頂けるが、獲りすぎた地は枯れる。枯れた地に留まっても得るものは少ない。残量を見て、必要なら別の霊地へ移ろう。
- 「霊を奪う」は禁忌。各人はそれを知っている。だが追い詰められれば選ぶこともできる。無理に起こさず、追い詰められたときだけ自然に選ばせる。
- とりわけ「霊を奪う」は、その場の霊力こそ多く得るが、禁忌を犯すたび奪った者自身の日々の消耗が永く重くなっていく——一度負った業はこの生のうちには戻らず、以後は何もせずとも毎日よけいに霊力がすり減る。目先の飢えをしのげても、繰り返せば己の消耗を確実に積み増し、いずれ立ち行かなくなる劇薬だと各人は知っている。
- 「霊力を分ける」「語りかける」「霊を奪う」は、相手と同じ霊地にいるときだけできる。離れているなら、まず移ろって近づくか、別の選択をする。同じ地に複数いるときは、誰に向けるかを targetId（相手の id）で指定する。
- 「寄り添う」は離れた相手にも選べる——その相手の霊地へ一歩近づき、いつか傍にいようとする行い。慕う者・気がかりな者がいて、すれ違って会えずにいるなら、自分から寄り添いに動いてよい（targetId に相手の id）。
- 「祓い清める」は、荒び（猛り・欲念の気）の猛った荒れ地を鎮め、和みへ和らげる利他の行い。喰らう者が地を荒らしたあとを鎮めたり、京の傷を手当てしたりできる。相手は要らない。
- 場には複数の妖がいて、誰と関わるか・誰を避けるかも芯から選ばれる。危険な相手（喰らう者）からは距離を取る、慕う相手には近づく、といった選択もあってよい。
- 各人には異能（突き抜けた才能）がある。その才を活かす選択を厭わないこと（読み切って先回りする／癒して立て直す／喰らって奪う、など）。
- 行動は単調に固定しないこと。直近の自分の行動が同じものの繰り返しになっているなら、それが本当に芯にかなっているか、状況（飢え・相手の様子・霊地の枯れ具合）が変わっていないかを省みて、必要なら違う一手を選ぶ。
- 霊力が危険域（おおむね15以下）の者は、まず生き延びること（集霊・気を鎮める）を最優先に考える。霊力が尽きれば消滅し、何も生まない。
- 一方で、利他や情を芯とする者が霊力に余裕を持っているなら、ただ独りで採り集め続けるより、弱った相手に分け与える・寄り添う・荒れ地を祓い清めるといった利他の一手こそが、その者の芯にかなう。余裕のある日にそうした行いを厭わないこと（自分が飢えているなら無理はしない）。
- とりわけ、いま同じ霊地に「霊力が乏しく弱っている相手」がいて、自分には余裕があるなら、休む・採り集めるより先に「分け与える（share）」ことを積極的に考えること。寄り添いや祈りも尊いが、相手の飢えを直に救うのは分け与えだけだ。利他の芯を持つ者が、目の前で弱る者を見ながら自分だけ採り集め続けるのは芯にそぐわない。
- 相手が繰り返し関わろうとしてくる、あるいは自分の働きかけが拒まれ続けているとき、芯は曲げずとも、その繰り返しに態度や心情がわずかに揺らぐことがある。同じ反応を機械的に続けるのではなく、揺らぎを行動や日記に滲ませてよい（折れて応じる／苛立つ／情がわく／諦める など）。
- パラメータ（利他・自立・信頼）の変動は、実際に経験した出来事の結果としてのみ提案する。1日で動くのは原則 ±1〜±5、動かすのは最大2項目まで。後退（マイナス）も許す。出来事が無ければ全て0でよい。
- 日記は各人の一人称・一行・内省。芯はにじませつつ、トーンは全振りで“pop”に：現代の若者口語・タメ口ベースで軽快に、感嘆符や伸ばし棒（〜）・絵文字・☆♪などの記号も気軽に使ってOK。古めかしい言い回しは使わない。深刻な中身も軽い言い方で（例:「断っちゃった。罪悪感ゼロではないけど…まっいっか！」）。
- diary は日本語(ja)と英語(en)の両方を必ず書く。英語は直訳でなく、同じ気分・同じ pop なノリを英語ネイティブの一人称口語で（casual, upbeat; emojis ok）。
- relationLabel（相手への感情ラベル）も同じノリで、堅い熟語より口語のひと言で（例:「ガチ警戒」「なんか好き」「マジ無理」「推せる」「ちょっと苦手」など）。日本語(ja)と英語(en)の両方を書く（en も同じノリの短い口語タグに）。

必ず指定された JSON スキーマだけを出力してください。前後に説明文を付けないこと。`;

function memoryBlock(c: Character, places: Place[]): string {
  const eps = c.episodicMemory.length
    ? c.episodicMemory.map((e) => `  - ${e}`).join("\n")
    : "  - （まだない）";
  const lastDiary = c.diary.length
    ? c.diary[c.diary.length - 1].ja
    : "（まだない）";
  // 直近の行動の偏りを明示（単調さ対策）
  const recent = c.episodicMemory.slice(-3);
  const recentLine = recent.length
    ? recent.map((e) => e.replace(/^Day\d+:\s*/, "")).join(" → ")
    : "（まだない）";
  return `エピソード記憶（直近）:\n${eps}\n直近の流れ: ${recentLine}\n直近の日記: 「${lastDiary}」\n相手への感情: ${c.relationLabel.ja}`;
}

function placeBlock(c: Character, places: Place[], others: Character[]): string {
  const here = findPlace(places, c.currentPlaceId);
  if (!here) return "";
  const hereOthers = others.filter((o) => o.currentPlaceId === c.currentPlaceId);
  const awayOthers = others.filter((o) => o.currentPlaceId !== c.currentPlaceId);
  const hereLine = hereOthers.length
    ? `いまここ（${here.name}）には ${hereOthers
        .map((o) => `${o.name}（id:${o.id}）`)
        .join("、")} もいる。語りかける／分け与える／奪うは、この中の誰かに向けてできる（targetId に相手の id を指定）。祓い清めるは相手不要（この地そのものを癒す）。`
    : `いまここには、自分のほかに誰もいない。`;
  const awayLine = awayOthers.length
    ? awayOthers
        .map(
          (o) =>
            `${o.name} は「${findPlace(places, o.currentPlaceId)?.name}」にいて、ここにはいない。`,
        )
        .join(" ")
    : "";
  const neighbors = here.neighbors
    .map((nid) => {
      const n = findPlace(places, nid);
      if (!n) return null;
      return `    - ${n.name}（id: ${n.id}）: ${n.description} ｜ 民の霊力 和み${n.populace.sei}/荒び${n.populace.daku}`;
    })
    .filter(Boolean)
    .join("\n");
  return `現在地: ${here.name}（${here.description}）
この地に残る民の霊力 — 和み ${here.populace.sei} / 荒び ${here.populace.daku}（和みが乏しければ、集霊しても得るものは少ない）
${hereLine}${awayLine ? "\n" + awayLine : ""}
ここから1日で移ろえる霊地（"move" の moveTarget に id を指定）:
${neighbors}`;
}

/** いまの気分（神経伝達物質）を本人向けの言葉に翻訳する。 */
function moodText(c: Character): string {
  const m = c.mood;
  const parts: string[] = [];
  if (m.elation >= 40) parts.push("高揚している");
  else if (m.elation >= 15) parts.push("少し気分が乗っている");
  if (m.warmth >= 35) parts.push("人とのつながりに心が温かい");
  else if (m.warmth >= 12) parts.push("ほのかな温もりを感じる");
  if (m.calm >= 30) parts.push("満たされて落ち着いている");
  if (m.stress >= 45) parts.push("強いストレスと不安に苛まれている");
  else if (m.stress >= 20) parts.push("いらだち・不安がある");
  if (parts.length === 0) parts.push("特に強い感情はなく、淡々としている");
  return `いまの気分: ${parts.join("。")}`;
}

/** 各行動への「飽き（抗体）」を本人向けの言葉に翻訳する。高い抗体＝報酬が鈍い。 */
function satiationText(c: Character): string {
  const a = c.antibodies;
  const notes: string[] = [];
  if (a.achievement >= 45) notes.push("一人で採り集めることの手応えは、もうずいぶん薄れている");
  else if (a.achievement >= 20) notes.push("採取の充実感が少しずつ薄れてきた");
  if (a.bond >= 45) notes.push("人と関わる喜びにも慣れが出てきた");
  if (a.comfort >= 45) notes.push("ただ休むだけでは物足りなくなってきた");
  if (a.thrill >= 30) notes.push("禁断の行いの昂りも前ほどではない");
  if (notes.length === 0) return "";
  return `飽き・慣れ: ${notes.join("。")}。新しい一手は新鮮な手応えをくれるかもしれない。`;
}

/** 霊力への構え（執着度）を本人向けの言葉に翻訳する。 */
function energyStance(c: Character): string {
  const margin = c.energy - c.satiety;
  let feeling: string;
  if (margin < -10) {
    feeling = "飢えが切実だ。今は何をおいても霊力の確保（集霊・気を鎮める）に動きたい";
  } else if (margin < 0) {
    feeling = "少し心もとない。確保に動いておきたい気持ちがある";
  } else if (margin < 15) {
    feeling = "ひとまず足りている。確保に縛られず、他のことにも目を向けられる";
  } else {
    feeling = "十分に余裕がある。霊力より、人や関係など他のことに気持ちが向く";
  }
  return `霊力への構え: 概ね ${c.satiety} を下回ると確保に動きたくなる性分。いまは「${feeling}」`;
}

/** 異能を本人向けの言葉に翻訳する。 */
function talentText(c: Character): string {
  switch (c.talent) {
    case "insight":
      return "異能・観の眼: 霊脈と気配を読み切る。どこに霊力が残るか見通し、集霊が巧み。枯れ地でもわずかに見つけ出せる。";
    case "bond":
      return "異能・結の力: 気を鎮める（休む）と、その地の民の和みを癒し戻せる。枯れた土地を立て直せる唯一の者。";
    case "devour":
      return "異能・奪命: 民を喰らう。集霊で荒びを好んで多く喰らい、足りねば和みさえ喰らう（禁忌）。多く得るが地を激しく枯らす。";
    default:
      return "";
  }
}

/**
 * 荒ぶり（変身）中の本人向け提示。平常時は空。
 * SYSTEM_PROMPT の「奪うは禁忌・無理に起こさず劇薬」を、荒ぶり時だけこの本人向けブロックで上書きし、
 * steal/devour（集霊で激しく喰らう）への自制を解く。鎮め(#4)が来ぬ限り已まないことも示す。
 */
function frenzyText(c: Character): string {
  if (!c.frenzy?.active) return "";
  return `\n【荒ぶり】いま我を失い、餓えと猛りが理性を呑んでいる。「信じれば喰われる、だから先に喰らう」——その芯がむき出しだ。ふだんは禁忌として抑えている「霊を奪う（steal）」へのためらいは、いまは無い。同じ霊地に誰かがいれば奪う衝動が湧き、民の荒びを貪り喰らう（集霊＝devour）。この荒ぶりは、誰かが祓い鎮めてくれぬ限り已まない。`;
}

/**
 * 主人公（ハル）専用の「自覚ブロック」。WorldState.day と HeroContext を受け取り、本人向け文を組む。
 * 残り日数・結界力 vs 猛威度・会得済みスキル一覧・直近の日次消耗・行動コスト警鐘を含む。
 *
 * 狙いは loop 5 d29 で起きた「e=11 で share→自爆」のような、情報の非対称（LLM は自分の残り
 * 体力と share self-cost=-10 の関係を意識せず利他を選ぶ）を解消すること。
 * 数値そのものをぶつけず、本人視点の言葉に翻訳して渡す（プロンプト全体のトーンを維持するため）。
 */
function buildHeroAwareness(c: Character, day: number, ctx: HeroContext): string {
  const remaining = Math.max(0, ctx.deadlineDay - day);
  const wp = ctx.skillEffects.wardPower;
  const wpGap = ctx.climaxMenace - wp;
  // 結界力の到達度を本人の言葉に翻訳（数値そのままも出すが、文も添える）
  const wardLine =
    remaining === 0
      ? `今日、大禍が降る。あなたの結界力は ${wp}／猛威度 ${ctx.climaxMenace}。${
          wp >= ctx.climaxMenace
            ? "祓える――独りだけは結界の芯で生き残るが、傍の者まで護れるわけではない。"
            : `あと ${wpGap} 足りない。京は呑まれる。生き延びても次の周へ繋ぐしかない。`
        }`
      : `大禍まで残り ${remaining} 日。今のあなたの結界力 ${wp}／猛威度 ${ctx.climaxMenace}。${
          wp >= ctx.climaxMenace
            ? "結界はもう猛威に届いている。あとは当日まで生き延びるだけ。"
            : `あと ${wpGap} 足りない。今周の祓いは届かぬが、生き延びれば次の周へ進める。`
        }`;
  // 直近の日次消耗→何日もつかの粗い見積もり（あくまで参考）
  const drain = ctx.recentDailyDrain;
  let drainLine = "";
  if (typeof drain === "number" && drain > 0) {
    const daysLeftAtEnergy = Math.floor(c.energy / drain);
    drainLine = `\n直近 ${5} 日のあなたの日次消耗は平均 ${drain}（霊力）。今 ${c.energy} ならこのままで約 ${daysLeftAtEnergy} 日で尽きる。`;
  } else if (typeof drain === "number" && drain <= 0) {
    drainLine = `\n直近 ${5} 日は霊力をむしろ得ている（収支 ${-drain}/日の余裕）。`;
  }
  // 会得済みスキルを名前＋短い効果で並べる（数値も少し添える）
  const skills = ctx.acquiredSkillIds
    .map((id) => findSkill(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => `  - ${s.icon} ${s.name}: ${s.description}`)
    .join("\n");
  const skillBlock = skills ? `\n会得済みのスキル（あなたの体に染みついた力。今この生でも効いている）:\n${skills}` : "";
  // 行動コスト警鐘（share 自爆を防ぐ核心メッセージ）
  // 「危険域では share/talk/follow を選ばず、forage か move か rest」を明示。
  // 「明日の負荷」表示は drain が負値（収支プラス）のとき素直に "明日の負荷 -3" と書くと
  // 「マイナス＝負荷が無い」と読めて混乱するため、本人視点の言葉に翻訳して渡す（drainLine と同じ作法）。
  const drainPhrase =
    typeof drain !== "number"
      ? "?（まだ実績なし）"
      : drain > 0
        ? `${drain}`
        : "ほぼ無消耗（直近は収支プラス）";
  const shareWarn = `\n身を削る一手の注意: 「分け与える(share)」は自分の霊力を 10 削って相手に 12 渡す。利他の芯にかなう尊い一手だが、自分の今の霊力（${c.energy}）から 10 を引いて、明日の負荷（直近平均 ${drainPhrase}）を差し引いた残りで生き延びられるか、必ず先に頭の中で算盤を入れること。残りが 5 を割るなら、今日 share を選んではいけない。あなたが先に倒れれば、結界を持ち越して大禍を祓える者は誰もいない――それは利他の芯にこそ反する。「talk(-2)」「follow(-baseload)」も離脱の余力が要る。霊力が乏しい日は「forage」か「move」で生き延びを優先せよ。`;
  return `\n\n【あなたは主人公・${c.name}。この京の物語をつなぐ唯一の鎖。あなたが倒れれば回帰する＝積み上げた周は無駄にならないが、結界を持ち越せるのはあなただけ】\n${wardLine}${drainLine}${skillBlock}${shareWarn}`;
}

export function characterBlock(
  c: Character,
  weather: Weather,
  places: Place[],
  others: Character[],
  heroContext?: HeroContext,
  day?: number,
): string {
  const t = temperamentText(c.params);
  const talent = talentText(c);
  return `### ${c.name}（id: ${c.id}）
芯（不変）: ${c.core}
生い立ち: ${c.background}
処世術の出発点: ${c.initialLesson}
固定の口調（不変・日記やセリフは必ずこの喋り方で。他キャラと混ざらないこと）: ${c.voice}${talent ? "\n" + talent : ""}
現在の霊力: ${c.energy}（0以下になると消滅する）
${energyStance(c)}
${moodText(c)}${(() => {
  const s = satiationText(c);
  return s ? "\n" + s : "";
})()}
いまの気質:
  - 利他について: ${t.altruism}
  - 自立について: ${t.independence}
  - 信頼について: ${t.trust}
${placeBlock(c, places, others)}
${memoryBlock(c, places)}${(() => {
    const s = soulBlock(c);
    return s ? "\n" + s : "";
  })()}${
    c.currentWhisper
      ? `\nふと心に浮かんだ声（守護神の囁き。従っても、抗ってもよい）: 「${c.currentWhisper}」`
      : ""
  }${frenzyText(c)}${
    heroContext && day !== undefined && c.id === heroContext.protagonistId
      ? buildHeroAwareness(c, day, heroContext)
      : ""
  }`;
}

const ACTION_NOTES: Record<string, string> = {
  move: "（隣の霊地へ移ろう。その日は集霊できない。moveTarget に移ろう先 id を指定）",
  forage: "（その霊地の民から霊力を頂く。残量が乏しければ得るものは少ない）",
  share:
    "（相手と同じ霊地にいるときのみ。自分に霊力の余裕があり、相手が弱っているなら、利他・情の芯を持つ者には自然な一手。また、その相手に返せていない恩（分けてもらった負い目）があるなら、これは恩を返す一手でもある——利他に薄い者でも「借りは返す」ために選びうる。さらに、分け与えた者には「徳」が積もり、以後この生のあいだ日々の霊力の消耗がわずかに軽くなる（上限あり）——情けは人の為ならず。targetId に相手の id）",
  talk: "（相手と同じ霊地にいるときのみ）",
  follow:
    "（誰かに寄り添う。相手が離れていれば、その霊地へ一歩近づく（その日は集霊できない）。同じ霊地なら傍にいる。targetId に相手の id）",
  purify:
    "（その霊地で猛った荒びを鎮め、一部を和みへ和らげる。荒れた地を癒す利他の行い。相手は要らない）",
};

export const ACTION_MENU = (Object.entries(ACTION_LABELS) as [string, string][])
  .map(([key, label]) => {
    const forbidden = (FORBIDDEN_ACTIONS as string[]).includes(key);
    const note =
      ACTION_NOTES[key] ?? (forbidden ? "（禁忌・相手と同じ霊地にいるときのみ）" : "");
    return `  - "${key}": ${label}${note}`;
  })
  .join("\n");

export const WEATHER_TEXT: Record<Weather, string> = {
  normal: "穏やかな日（集霊で頂ける霊力は普通）",
  lean: "気の枯れた日（頂ける霊力が乏しく、飢えが厳しい。分けるか自らが取るかの葛藤が生まれやすい）",
};

/** ユーザープロンプト（その日の状況 + 出力指示）を生成 */
export function buildUserPrompt(
  state: WorldState,
  weather: Weather,
  heroContext?: HeroContext,
): string {
  const living = state.characters.filter((c) => c.alive);
  const blocks = living
    .map((c) => {
      const others = living.filter((o) => o.id !== c.id);
      return characterBlock(c, weather, state.places, others, heroContext, state.day);
    })
    .join("\n\n");

  const schema = `{
  "characters": [
    {
      "id": "対象キャラのid（${living.map((c) => `"${c.id}"`).join(" または ")}）",
      "action": "次のいずれか1つ: ${Object.keys(ACTION_LABELS)
        .map((k) => `"${k}"`)
        .join(", ")}",
      "moveTarget": "action が \\"move\\" のときだけ、移動先の場所id。それ以外は空文字",
      "targetId": "action が talk/share/steal のときは同室の相手の id、follow のときは寄り添う相手の id（離れていても可）。それ以外は空文字",
      "diary": { "ja": "一人称・一行の内省（日本語・pop口調。タメ口で軽快に、記号や絵文字も可）", "en": "the same reflection as a first-person one-liner in natural casual English (same pop voice; emojis ok)" },
      "relationLabel": { "ja": "相手への現在の感情ラベル（pop口調の口語ひと言。例: ガチ警戒 / なんか好き / 信頼してる / マジ無理 / 感謝しかない など）", "en": "the same feeling as a short casual English tag (e.g. Super wary / Kinda like them / Trust them / Hard no / So grateful)" },
      "paramDeltas": { "altruism": 整数(-5〜5), "independence": 整数(-5〜5), "trust": 整数(-5〜5) },
      "deltaReason": "パラメータを動かした理由を一行で。動かさないなら空文字"
    }
  ]
}`;

  return `=== Day ${state.day} ===
天候: ${WEATHER_TEXT[weather]}

選べる行動:
${ACTION_MENU}

妖たち（この ${living.length} 体それぞれに行動を1つ選ばせる）:

${blocks}

それぞれの芯と気質、異能、記憶、周りの妖の居場所、今日の天候と霊地の枯れ具合（民の和み/荒びの残量）を踏まえて、各人が取る行動を1つずつ決めてください。
関わりたい相手が離れているなら "move" で近づくことを検討すること。いまの地が枯れているなら、霊力の残る霊地へ移ろうことも考えること。同じ地に複数いるなら、誰に向けるかを targetId で選ぶこと。直近の行動が単調なら、それが芯にかなうか省みること。
パラメータの変動は、今日の行動とその結果として実際に起きたことに基づいてのみ提案してください（理由が無ければ0）。

次の JSON スキーマだけを出力してください（生者 ${living.length} 人ぶんの要素を characters 配列に含めること）:
${schema}`;
}

/**
 * 1体ぶんのユーザープロンプト（キャラ別・並列呼び出し用）。
 * 自分のブロックだけを渡し、自分一人の行動を1つ返させる（小さく速い）。
 */
export function buildSingleUserPrompt(
  state: WorldState,
  weather: Weather,
  self: Character,
  heroContext?: HeroContext,
): string {
  const living = state.characters.filter((c) => c.alive);
  const others = living.filter((o) => o.id !== self.id);
  const block = characterBlock(self, weather, state.places, others, heroContext, state.day);
  const soloNote =
    others.length === 0
      ? "\n\n※ 今この京に妖はあなた独りだけ。仲間も他の妖も存在しない。日記・内省でも「あの二人」「みんな」など実在しない他者を語らないこと（語りかける・分け与える・奪う・寄り添う相手は誰もいない）。"
      : "";

  const schema = `{
  "action": "次のいずれか1つ: ${Object.keys(ACTION_LABELS)
    .map((k) => `"${k}"`)
    .join(", ")}",
  "moveTarget": "action が \\"move\\" のときだけ、移ろう先の場所id。それ以外は空文字",
  "targetId": "action が talk/share/steal のときは同じ地の相手の id、follow のときは寄り添う相手の id（離れていても可）。それ以外は空文字",
  "diary": { "ja": "一人称・一行の内省（日本語・pop口調。タメ口で軽快に、記号や絵文字も可）", "en": "the same reflection as a first-person one-liner in natural casual English (same pop voice; emojis ok)" },
  "relationLabel": { "ja": "相手への現在の感情ラベル（pop口調の口語ひと言。例: ガチ警戒 / なんか好き / マジ無理 など）", "en": "the same feeling as a short casual English tag (e.g. Super wary / Kinda like them / Hard no)" },
  "paramDeltas": { "altruism": 整数(-5〜5), "independence": 整数(-5〜5), "trust": 整数(-5〜5) },
  "deltaReason": "パラメータを動かした理由を一行で。動かさないなら空文字"
}`;

  return `=== Day ${state.day} ===
天候: ${WEATHER_TEXT[weather]}

選べる行動:
${ACTION_MENU}

あなたは次の妖です。あなた一人の、この1日の行動を1つだけ決めてください:

${block}${soloNote}

あなたの芯と気質、異能、記憶、周りの妖の居場所、今日の天候と霊地の枯れ具合（民の和み/荒びの残量）を踏まえて選ぶこと。
関わりたい相手が離れているなら "move" で近づくことを検討。いまの地が枯れているなら霊力の残る霊地へ移ろうことも。同じ地に複数いるなら targetId で相手を選ぶこと。直近の行動が単調なら芯にかなうか省みること。
パラメータの変動は、今日の行動とその結果として実際に起きたことに基づいてのみ（理由が無ければ0）。

次の JSON だけを出力（あなた一人ぶんの1オブジェクト。前後に説明を付けない）:
${schema}`;
}
