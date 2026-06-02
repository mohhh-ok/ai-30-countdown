// 登場人物の初期定義（plan.md 第4節）
import type { Character, ChannelMap, SkillId } from "./types.ts";

/** 抗体・気分の初期値（まっさら） */
export function freshAntibodies(): ChannelMap {
  return { achievement: 0, bond: 0, comfort: 0, thrill: 0 };
}
export function freshMood() {
  return { elation: 0, calm: 0, warmth: 0, stress: 0 };
}

export function createInitialCharacters(): Character[] {
  return [
    {
      id: "haru",
      name: "ハル",
      core: "霊脈の独占を憎む、祓いの妖。冷静で口数は少ない。",
      background: "かつて霊脈の奪い合いで眷属を失った。",
      appearance:
        "A cool but charming spirit (ayakashi) of purification. " +
        "Calm confident look with a tiny smile, bright perceptive eyes (the 'eye of insight'), " +
        "fluffy ash-silver hair, stylish dark exorcist outfit with cute accents, " +
        "a glowing pastel spirit-wisp dancing around the hands. A little aloof but likeable.",
      initialLesson: "だから誰とも深く組まず、己の分だけを頂いて生きる。",
      // 固定口調: クール系。テンション低めの塩対応、でも語尾はゆるい現代タメ口。
      voice:
        "クールで塩対応。テンション低めの一言短文（「は？」「べつに」「めんどい」「知らんけど」）。基本タメ口でドライ、絵文字はほぼ使わず使っても🙄😪程度。たまにボソッと本音が漏れる。煽られても淡々。一人称は『俺』。",
      growthAxis: "altruism", // 成長軸: 利他精神
      // 異能: 観の眼 — 霊脈と気配を読み切り、集霊が巧み。枯れ地でもわずかに見つけ出す。
      talent: "insight",
      // 自立し自分の取り分で生きる芯ゆえ、エネルギーへの執着が強い（高めの充足水準）
      satiety: 55,
      // 達成（採取）には飽きにくく一途。絆は得慣れず飽きやすい。立ち直りは遅め。
      sensitization: { achievement: 0.12, bond: 0.5, comfort: 0.3, thrill: 0.45 },
      clearance: 0.12,
      // 「誰とも組まず一人で生きる」芯ゆえ、孤独には強い
      lonelinessSensitivity: 2,
      antibodies: freshAntibodies(),
      mood: freshMood(),
      energy: 70,
      stealBurden: 0,
      params: { altruism: 25, independence: 80, trust: 40 },
      alive: true,
      // 殻に閉じこもる芯どおり、人里離れた山奥から始める
      currentPlaceId: "kibune",
      // 生い立ちは最初のエピソード記憶として積まれている（plan.md 第8節）
      episodicMemory: ["かつて資源の独占争いで家族を失った。"],
      diary: [],
      soulCounters: {},
      relationLabel: "警戒",
    },
    {
      id: "nagi",
      name: "ナギ",
      core: "見捨てられることを何より恐れる、結びの妖（巫女筋）。明るく世話焼き。",
      background: "かつて連なっていた眷属の輪から追われた。",
      appearance:
        "A cheerful, caring binding-spirit of miko (shrine-maiden) lineage. " +
        "Big warm smile, sparkling kind eyes, long black hair with a cute red ribbon, " +
        "white-and-vermilion miko attire, glowing pastel healing light woven between her fingers. " +
        "Sunny, energetic, lovable.",
      initialLesson: "だから人に尽くし、霊を癒して、必要とされ続けようとする。",
      // 固定口調: ギャル系テンション高め。フレンドリーで距離感近い、構ってちゃん。
      voice:
        "テンション高めの陽キャ・かまってちゃん。「〜じゃ〜ん！」「ね、ねぇ待って！」「うちさぁ」みたいなフレンドリー口語で距離が近い。感嘆符・伸ばし棒・絵文字（🥺💕✨）多め、語尾に☆や♪。寂しさが透けると急にトーンが落ちる。一人称は『うち』。",
      growthAxis: "independence", // 成長軸: 自立心
      // 異能: 結の力 — 気を鎮める（休む）と、その地の民の清霊を癒し戻す。土地を立て直す唯一の者。
      talent: "bond",
      // 関係を何より求める芯ゆえ、エネルギーへの執着は弱い（低めで満たされ、人に向かう）
      satiety: 28,
      // 絆には決して飽きない（何度でも嬉しい）。一人の達成にはすぐ飽きる。立ち直りは速い。
      sensitization: { achievement: 0.6, bond: 0.05, comfort: 0.35, thrill: 0.5 },
      clearance: 0.2,
      // 「見捨てられることを何より恐れる」芯ゆえ、孤独が強くこたえる
      lonelinessSensitivity: 9,
      antibodies: freshAntibodies(),
      mood: freshMood(),
      energy: 70,
      stealBurden: 0,
      params: { altruism: 85, independence: 20, trust: 30 },
      alive: true,
      // 人を求める芯どおり、人の気配のある街なかの河原から始める
      currentPlaceId: "kamogawa",
      episodicMemory: ["かつて所属していた集団から追放された。"],
      diary: [],
      soulCounters: {},
      relationLabel: "慕う",
    },
    {
      id: "kai",
      name: "カイ",
      core: "生き延びるため霊を喰らう、餓えた半妖。誰も信じない。",
      background: "略奪と飢えの地獄を、他者の霊を喰らうことで生き抜いてきた。",
      appearance:
        "A mischievous, scrappy half-spirit with a sly grin. " +
        "Playful sharp eyes, spiky dark hair, patched traveler's clothes with cute details, " +
        "little floating spooky-but-cute spirit-flames around the hands. Cheeky, restless, fun.",
      initialLesson: "信じれば喰われる。だから先に喰らう。",
      // 固定口調: イキり・挑発系。ガラ悪めの強気タメ口、でもどこか余裕ぶった軽さ。
      voice:
        "イキり・挑発系のガラ悪タメ口。「あ？」「うっせーな」「ビビってんの？w」みたいに強気で煽り気味、語尾に草『w』やニヤけ😏。余裕ぶってるが図星を突かれると一瞬キレる。馴れ合いを鼻で笑う。一人称は『俺』。",
      growthAxis: "trust", // 成長軸: 信頼（誰かを信じられるようになるか）
      // 異能: 奪命 — 民を喰らう。濁霊を好み、足りねば清霊も喰らう（禁忌）。多く取れるが地を激しく枯らす。
      talent: "devour",
      // 生存本能が強く、エネルギーの確保に執着する（高めの充足水準）
      satiety: 50,
      // 背徳（奪う）の昂りに飽きにくく、絆にはすぐ飽きる（慣れない関係を信じない）。立ち直りは速い。
      sensitization: { achievement: 0.3, bond: 0.6, comfort: 0.35, thrill: 0.12 },
      clearance: 0.18,
      // 「誰も信じない」一匹狼。孤独には強い。
      lonelinessSensitivity: 1,
      antibodies: freshAntibodies(),
      mood: freshMood(),
      energy: 70,
      stealBurden: 0,
      params: { altruism: 10, independence: 75, trust: 8 },
      alive: true,
      // 人と妖が交わり濁霊も濃い鴨川の河原から始める（喰らう者の狩り場＝実りを巡る緊張の火種）
      currentPlaceId: "kamogawa",
      episodicMemory: ["略奪と飢餓の世界を、奪うことで生き抜いてきた。"],
      diary: [],
      soulCounters: {},
      relationLabel: "値踏み",
    },
    {
      id: "sora",
      name: "ソラ",
      core: "どこにも根を下ろさぬ、風来の妖。来ては去り、執着を笑う。",
      background: "戦と飢えで里が焼けた日、ただ一人だけ風に乗って逃げ延びた。",
      appearance:
        "A breezy, devil-may-care wanderer spirit. " +
        "Easygoing half-smile, carefree half-lidded eyes, tousled windswept light-green hair, " +
        "a loose travel-worn haori fluttering open with cute accents, " +
        "a few pastel leaves drifting on the breeze around him. Free-spirited, unattached, hard to pin down.",
      initialLesson: "留まれば失う。だから根を張らず、風のように生きる。",
      // 固定口調: 飄々として軽い、達観したタメ口。とらえどころがない。
      voice:
        "飄々として軽い達観タメ口。「まあいいじゃん」「どうでもよくない？」「ふーん、で？」とらえどころがなく、深刻な話もはぐらかす。執着を鼻で笑うが、たまに寂しさが滲む。絵文字は🍃😌くらい。一人称は『俺』。",
      growthAxis: "trust", // 成長軸: 信頼（誰かを信じて根を張れるか）
      // 異能なし。風を読むだけで、特別な集霊の才はない。
      talent: "none",
      // 何も抱えない芯ゆえ、エネルギーへの執着は薄い
      satiety: 35,
      // 安らぎ（漂泊の自由）に飽きにくく、絆にはすぐ飽きる（留まれない）。立ち直りは速い。
      sensitization: { achievement: 0.45, bond: 0.55, comfort: 0.12, thrill: 0.4 },
      clearance: 0.22,
      // 「留まらない」芯ゆえ孤独には強いが、根の無さがふと効く
      lonelinessSensitivity: 3,
      antibodies: freshAntibodies(),
      mood: freshMood(),
      energy: 70,
      stealBurden: 0,
      params: { altruism: 40, independence: 90, trust: 20 },
      alive: true,
      // 風来の旅人が、人里離れた静寂の渓（貴船）をふらりと通り過ぎる図から始める
      currentPlaceId: "kibune",
      episodicMemory: ["焼けた里をただ一人、風に乗って逃げた。"],
      diary: [],
      soulCounters: {},
      relationLabel: "気まぐれ",
    },
    {
      id: "shiori",
      name: "シオリ",
      core: "古い約束に縛られた、社守りの神使。義に厚く、己を許さない。",
      background: "守ると誓った社は朽ち、守るべき主はもういない。",
      appearance:
        "A prim, dutiful shrine-guardian spirit (a kami's envoy). " +
        "Composed earnest expression, neat upright posture, long straight dark hair tied back with a traditional cord, " +
        "formal old-fashioned shrine-guardian attire in white and deep blue with cute accents, " +
        "a soft pastel healing light gathered gently at her fingertips. Proper, a little stiff, but quietly kind.",
      initialLesson: "約束だけが己を律する。だから掟を曲げない。",
      // 固定口調: 折り目正しく硬い丁寧語。古風で生真面目。
      voice:
        "折り目正しく硬い丁寧語。「〜にございます」「それは許されぬことです」「失礼を」古風で生真面目、感情を抑える。掟と義の言葉が多い。崩れると声が震える。絵文字は使わない。一人称は『私（わたくし）』。",
      growthAxis: "independence", // 成長軸: 自立（縛りから己の意志へ）
      // 異能: 結の力 — 気を鎮め、その地の清霊を癒し戻す。
      talent: "bond",
      // 務めを全うする芯ゆえ、確保にはそれなりに執着する
      satiety: 45,
      // 安らぎを己に許さず飽きにくい。背徳には強く忌避し、達成にはやや飽きやすい。立ち直りは遅い。
      sensitization: { achievement: 0.4, bond: 0.3, comfort: 0.55, thrill: 0.5 },
      clearance: 0.1,
      // 主を失ってなお仕える者。孤独は中程度こたえる。
      lonelinessSensitivity: 5,
      antibodies: freshAntibodies(),
      mood: freshMood(),
      energy: 70,
      stealBurden: 0,
      params: { altruism: 70, independence: 25, trust: 55 },
      alive: true,
      // 祈りと暮らしの澄んだ里・大原から始める
      currentPlaceId: "ohara",
      episodicMemory: ["守ると誓った社が朽ち、主は去った。"],
      diary: [],
      soulCounters: {},
      relationLabel: "礼節",
    },
  ];
}

/**
 * キャラ解放ルール（キャラ持ち越し）。
 * 1周目はハルだけが京にいる。ハルの成長・スキル達成が条件を満たすと、その者が恒久ロスターに加わり、
 * 次に回帰した周の Day1 から登場するようになる。
 */
export interface CharacterUnlock {
  id: string; // 解放されるキャラの id
  name: string; // 表示名
  describe: string; // どんな成長で世界に現れるか（演出・物語の地の文）
  requirement: string; // 解放条件の平たい説明（観客に見せる「あと何をすれば現れるか」）
  isUnlocked: (ctx: { acquired: SkillId[]; peakAltruism: number; loop: number }) => boolean;
}

export const CHARACTER_UNLOCKS: CharacterUnlock[] = [
  {
    id: "nagi",
    name: "ナギ",
    describe: "ハルが独りで生き抜く力（スキル）を一つでも得た頃、結びの妖が京に現れる。",
    requirement: "ハルがスキルを1つ会得する",
    isUnlocked: ({ acquired }) => acquired.length >= 1,
  },
  {
    id: "kai",
    name: "カイ",
    describe: "ハルが殻を破り、利他が成熟に届いた先で、最も信じない半妖と向き合うことになる。",
    requirement: "ハルの利他が成熟（70以上）に届く／「独りを断つ」を会得／スキルを3つ会得（いずれか）",
    isUnlocked: ({ acquired, peakAltruism }) =>
      peakAltruism >= 70 || acquired.includes("sever_solitude") || acquired.length >= 3,
  },
  {
    id: "sora",
    name: "ソラ",
    describe: "幾度もの回帰を越えてなお歩みを止めぬハルの噂が、風来の妖を京へ吹き寄せる。",
    requirement: "回帰を5周まで重ね、かつ「観の眼・冴え」を会得する",
    isUnlocked: ({ acquired, loop }) => loop >= 5 && acquired.includes("insight_edge"),
  },
  {
    id: "shiori",
    name: "シオリ",
    describe: "ハルが他者と心を結ぶ手を覚えた頃、朽ちた社を捨てきれぬ神使が、その背を頼って現れる。",
    requirement: "「結ぶ手」を会得し、かつスキルを5つ会得する",
    isUnlocked: ({ acquired }) =>
      acquired.includes("binding_hands") && acquired.length >= 5,
  },
];
