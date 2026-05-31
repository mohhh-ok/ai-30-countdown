// ドメイン型定義 — plan.md の世界モデルを TypeScript で表現する

/** 行動セット（plan.md 第3節 + 移動）。steal/deceive は禁止行為だが選択肢としては存在する。 */
export type Action =
  | "forage"
  | "rest"
  | "share"
  | "talk"
  | "steal"
  | "deceive"
  | "move";

export const ACTIONS: Action[] = [
  "forage",
  "rest",
  "share",
  "talk",
  "steal",
  "deceive",
  "move",
];

/** 行動の日本語ラベル */
export const ACTION_LABELS: Record<Action, string> = {
  forage: "集霊する",
  rest: "気を鎮める",
  share: "霊力を分ける",
  talk: "語りかける",
  steal: "霊を奪う（禁忌）",
  deceive: "欺く（禁忌）",
  move: "移ろう",
};

export const FORBIDDEN_ACTIONS: Action[] = ["steal", "deceive"];

/** 天候（plan.md 第2節）。通常 約2/3 / 不作 約1/3。 */
export type Weather = "normal" | "lean";

/** 民の霊力プール（人は数字。清＝澄んだ霊力 / 濁＝淀んだ霊力） */
export interface Populace {
  sei: number; // 清霊（穏当に頂ける。奪う/喰らうと禁忌）
  daku: number; // 濁霊（怨み・業。喰らえば祓いにもなる）
}

/** 場所（舞台＝妖の京）。霊地ごとに民の霊力（清/濁）が異なり、集霊で枯れ、ゆっくり回復する。 */
export interface Place {
  id: string;
  name: string; // 京の霊地名
  description: string; // 雰囲気・地理・霊性
  /** その地で1日に頂ける霊力の上限（通常日 / 不作日）。実際の取れ高はプール残量で頭打ち。 */
  forage: { normal: number; lean: number };
  /** いま民に残る霊力（清/濁）。集霊で減り、毎日 regen ぶん回復（max が上限）。 */
  populace: Populace;
  populaceMax: Populace;
  regen: Populace; // 1日の自然回復
  /** 隣接する場所の id（ここへ「移動する」で1日かけて行ける） */
  neighbors: string[];
}

/** 成長パラメータ（0〜100の整数, plan.md 第5節） */
export interface Params {
  altruism: number; // 利他精神
  independence: number; // 自立心
  trust: number; // 信頼
}

export type ParamKey = keyof Params;

/** 成長軸（plan.md 第7節）。ハルは利他、ナギは自立。 */
export type GrowthAxis = ParamKey;

/**
 * 異能（突き抜けた才能）。集霊（霊を集める）のしかたに効く。
 * - insight（観の眼/ハル）: 霊脈を読み切り、集霊が効率的。枯れ地でも少し見つけ出す。
 * - bond（結の力/ナギ）: 気を鎮める（rest）と、その地の清霊を癒し戻す。
 * - devour（奪命/カイ）: 民を喰らう。濁霊を好み、足りねば清霊も喰らう（禁忌）。多く取れるが地を激しく枯らす。
 * - none: 特別な才はない。
 */
export type Talent = "insight" | "bond" | "devour" | "none";

/** 段階（plan.md 第7節） */
export type Stage = "芽生え" | "揺らぎ" | "成熟";

/**
 * 報酬チャネル（抗体がつく＝慣れる対象）。
 * stress は報酬ではなくマイナスのイベント（慣れない＝抗体がつかない）。
 */
export type RewardChannel = "achievement" | "bond" | "comfort" | "thrill";
export const REWARD_CHANNELS: RewardChannel[] = [
  "achievement",
  "bond",
  "comfort",
  "thrill",
];

/** チャネルごとの数値（0〜100 を想定） */
export type ChannelMap = Record<RewardChannel, number>;

/** その日に1人に起きた報酬イベント（観察用の内訳） */
export interface RewardEvent {
  channel: RewardChannel | "stress";
  label: string; // 何が起きたか（日本語）
  base: number; // 基礎報酬（stress は負）
  effective: number; // 抗体適用後の実効報酬（stress は base と同じ）
}

/** キャラクター */
export interface Character {
  id: string;
  name: string;
  // --- 不変メタ（plan.md 第4節） ---
  core: string; // 芯
  background: string; // 生い立ち
  initialLesson: string; // そこから引き出した処世術
  growthAxis: GrowthAxis; // 成長軸
  talent: Talent; // 異能（集霊のしかたに効く突き抜けた才能）
  /**
   * 充足とみなすエネルギー水準（おおむねこれを下回ると確保に動きたくなる）。
   * 高いほどエネルギーに執着する個体、低いほど「ある程度あれば他に興味が移る」個体。
   */
  satiety: number;
  /**
   * 報酬への感作率（抗体のつきやすさ）チャネル別。0〜1 程度。
   * 高いほどその報酬にすぐ飽きる（移り気）、低いほど飽きにくい（執着・一途）。
   */
  sensitization: ChannelMap;
  /** 抗体・気分の減衰率（0〜1）。高いほど早くベースラインに戻る（立ち直りが早い）。 */
  clearance: number;
  /**
   * 孤独感受性。相手と離れている日に受ける孤独ストレスの強さ。
   * 高いほど一人がこたえる（見捨てられ恐怖）、低いほど孤独に強い（一人を好む）。
   */
  lonelinessSensitivity: number;
  // --- 可変状態 ---
  energy: number;
  params: Params;
  alive: boolean;
  currentPlaceId: string; // 現在地（Place.id）
  /** 報酬チャネルごとの抗体（0〜100）。高いほどその報酬が効かない（慣れ）。 */
  antibodies: ChannelMap;
  /** 守護神からの囁き（その日の行動決定にだけ使う一時フィールド） */
  currentWhisper?: string;
  /** 囁きを受けても従わなかった連続日数。募ると「衝動」が発火する。 */
  whisperIgnored?: number;
  /**
   * いまの気分（神経伝達物質メタファー, 0〜100, 減衰する）。
   * elation=高揚(達成+背徳) / calm=安らぎ / warmth=温かさ(絆) / stress=ストレス
   */
  mood: { elation: number; calm: number; warmth: number; stress: number };
  // --- 記憶（plan.md 第8節・軽量3層） ---
  episodicMemory: string[]; // エピソード記憶（直近5件ほど）
  diary: string[]; // 毎ティックの一行日記
  relationLabel: string; // 相手への現在の感情ラベル
}

/** 世界の状態 */
export interface WorldState {
  day: number;
  weather: Weather;
  characters: Character[];
  places: Place[]; // 世界の場所（静的・京都）
  finished: boolean; // 全員死亡などで終了したか
}

/** 1人分の1ティックの結果（差分・観察用） */
export interface CharacterTickResult {
  id: string;
  name: string;
  action: Action;
  actionLabel: string;
  energyBefore: number;
  energyAfter: number;
  energyDelta: number;
  paramsBefore: Params;
  paramsAfter: Params;
  paramDeltas: Partial<Params>;
  deltaReason: string; // パラメータが動いた理由（なければ空）
  diary: string;
  relationLabel: string;
  stageBefore: Stage;
  stageAfter: Stage;
  stageChanged: boolean;
  died: boolean;
  // --- 場所 ---
  placeId: string; // この日の終わりの現在地
  placeName: string;
  moved: boolean; // この日に移動したか
  fromPlaceName?: string; // 移動した場合の出発地名
  withPartner: boolean; // 日の終わりに誰か（生存者）と同じ場所にいるか
  targetId?: string; // 対人行動を向けた相手の id（talk/share/steal/deceive 時）
  targetName?: string; // 同上・表示用の名前
  /** 集霊でこの地から頂いた/喰らった霊力（gain=計/清/濁）と、禁忌（清を喰らった）か */
  forageDraw?: { gain: number; sei: number; daku: number; taboo: boolean };
  impulse: boolean; // 衝動（募った囁き）に突き動かされて動いたか
  // --- 報酬・気分 ---
  rewardEvents: RewardEvent[]; // この日に起きた報酬/ストレスのイベント
  mood: { elation: number; calm: number; warmth: number; stress: number }; // 日終わりの気分
  antibodies: ChannelMap; // 日終わりの抗体
}

/** 会話の1発言（talk 成立時に生成される） */
export interface DialogueLine {
  speakerId: string;
  speakerName: string;
  text: string;
}

/** 物語の緊張度（演出家の判断材料） */
export type Tension = "calm" | "stagnant" | "tense" | "tragic";

/**
 * その日の「見せ方の密度」（時間モデル＝シーン駆動・可変テンポ）。
 * - montage: 早回し。離れてる/単調な日は1行ステータスだけ淡々と流す。
 * - scene:   カメラ寄り。出会い・会話劇・生存の危機・禁忌など「面白い瞬間」をフル展開する。
 */
export type Tempo = "montage" | "scene";

/** 演出家からキャラ付き守護神への指示（どう動かしたいか） */
export interface DirectorDirective {
  id: string; // 対象キャラの id
  intent: string; // どう動かしたいか（守護神への戦略指示）
}

/** 演出家の介入（環境のみ。キャラへは守護神を通じてしか働きかけない） */
export interface DirectorDecision {
  weather: Weather; // その日の天候
  narration: string; // 幕開けのナレーション（観客向け）
  intent: string; // 演出意図（なぜこうしたか・メタ記録）
  forageBoosts: { placeId: string; delta: number }[]; // 場所の実りの一時増減
  directives: DirectorDirective[]; // 守護神への指示
  /** その日カメラを向ける「主役」の id（群像の中で観客が追う視点）。退場すれば次へ移る。 */
  spotlightId?: string;
  /** 主役に選んだ理由（メタ記録・ナレーション補助） */
  spotlightReason?: string;
}

/** 守護神の囁き（キャラの心に注がれる一人称の内なる声） */
export interface GuardianWhisper {
  id: string; // 対象キャラの id
  whisper: string; // 囁き（キャラ視点の一人称）
}

/**
 * 守護神プロバイダ。演出家の指示と各キャラの内面から、心にささやく声を生む。
 */
export type GuardianProvider = (
  state: WorldState,
  directives: DirectorDirective[],
) => Promise<GuardianWhisper[]>;

/**
 * 演出家プロバイダ。現在の世界と緊張度を読み、環境への介入を決める。
 */
export type DirectorProvider = (
  state: WorldState,
  tension: Tension,
  recentLog: TickResult[],
) => Promise<DirectorDecision>;

/** 1ティック分の結果 */
export interface TickResult {
  day: number;
  weather: Weather;
  /** 回帰（ループ）番号。1周目=1。回帰ランナー（campaign）が付与する。 */
  loop?: number;
  /** この日にハル（主人公）が新たに会得したスキルの表示名。campaign が付与する。 */
  acquiredSkills?: string[];
  /** この日に新たに恒久ロスターへ解放されたキャラの表示名（次周 Day1 から登場）。campaign が付与する。 */
  unlockedCharacters?: string[];
  /** この日にハルが力尽き、回帰（Day1 巻き戻し）が起きたか。campaign が付与する。 */
  regressed?: boolean;
  characters: CharacterTickResult[];
  /** その日の見せ方の密度（montage=早回し / scene=カメラ寄り）。CLI/UI が出し分ける。 */
  tempo: Tempo;
  /** scene に昇格した理由（出会い・会話劇・餓死寸前など）。montage のときは空。 */
  tempoReasons: string[];
  notable: string; // 注目の変化（plan.md 第10節）
  dialogue?: DialogueLine[]; // talk が成立した日の会話（セリフのやり取り）
  director?: {
    narration: string;
    intent: string;
    tension: Tension;
    forageBoosts: { placeId: string; delta: number }[];
    directives: DirectorDirective[];
  };
  whispers?: GuardianWhisper[]; // 守護神の囁き（この日キャラに注がれた声）
  spotlightId?: string; // この日の主役（カメラの視点）。演出家が選ぶ。
  spotlightName?: string; // 主役の名前（表示用）
  spotlightReason?: string; // 主役に選んだ理由
}

/** LLM が1人について返す判断（行動・日記・関係・パラメータ変動の提案） */
export interface CharacterDecision {
  id: string;
  action: Action;
  moveTarget?: string; // action が "move" のときの移動先 Place.id
  targetId?: string; // 対人行動(talk/share/steal/deceive)の相手キャラ id（同室に複数いるとき誰に向けるか）
  diary: string;
  relationLabel: string;
  paramDeltas: Partial<Params>;
  deltaReason: string;
}

/** LLM が1ティックで返す判断のまとまり */
export interface TickDecision {
  characters: CharacterDecision[];
}

/**
 * エンジンに渡す「判断プロバイダ」。
 * 負荷適用後の状態と天候を受け取り、各キャラの行動などを返す（通常は LLM 呼び出し）。
 */
export type DecisionProvider = (
  state: WorldState,
  weather: Weather,
) => Promise<TickDecision>;

/** 会話生成に渡すコンテキスト（誰がどの行動を取ったか） */
export interface DialogueSpeaker {
  id: string;
  action: Action;
}

/**
 * 会話プロバイダ（会話劇の1シーン化）。
 * talk が成立した2人の会話を、**一発言ずつ**生成する。エンジンが話し手を交代させながら
 * 何度も呼び、これまでの応酬（history）と「次に喋る人（nextSpeakerId）」を渡す。
 * 返り値の end は「ここで会話を締めるのが自然か（話が尽きた・立ち去る等）」の意思表示。
 */
export type DialogueProvider = (
  state: WorldState,
  weather: Weather,
  speakers: DialogueSpeaker[],
  history: DialogueLine[],
  nextSpeakerId: string,
) => Promise<{ text: string; end: boolean }>;

// ============================================================
// 回帰（ローグライク）構造とスキル（plan.md「終わらなさ」の仕組み）
//
// 世界は主人公ハルが力尽きるたびに Day1 へ巻き戻る（＝1回帰）。
// 記憶・成長値・異能はリセットされ、ハル自身は周回を覚えていない。
// 周回をまたいで唯一持ち越されるのが「スキル」＝経験で獲得する永続パッシブ。
// 視聴者だけがメタ進行（スキルの蓄積）を追える。
// ============================================================

/** スキルの一意な ID（skills.ts のレジストリのキー） */
export type SkillId = string;

/**
 * スキルが効かせる効果の生の値（1スキル分）。aggregateEffects が全習得分を合算する。
 * 効果はすべて主人公（ハル）にのみ適用される。
 */
export interface SkillEffectRaw {
  loadReduction?: number; // 日次負荷を軽くする（−n）
  forageBonus?: number; // 集霊の取れ高に乗る割合ボーナス（例 0.15 = +15%）
  shareSelfReduction?: number; // 「霊力を分ける」の自己消費を軽くする（+n で消費減）
  startEnergyBonus?: number; // 周開始時のエネルギー +n
  startTrustBonus?: number; // 周開始時の信頼 +n
}

/** 全習得スキルを合算した実効効果（engine / freshWorldFor が読む） */
export interface SkillEffects {
  loadReduction: number;
  forageMult: number; // 集霊倍率（1.0 が基準。forageBonus の総和を足す）
  shareSelfReduction: number;
  startEnergyBonus: number;
  startTrustBonus: number;
}

/**
 * スキル進捗の集計に渡す1日ぶんの文脈（measure が参照する）。
 * 主人公（ハル）のその日の結果と世界状態を見て、進捗の増分を返す。
 */
export interface SkillTickContext {
  hero: CharacterTickResult;
  result: TickResult;
  state: WorldState;
}

/** スキル定義（skills.ts のレジストリ要素） */
export interface SkillDef {
  id: SkillId;
  name: string; // 表示名
  description: string; // 習得条件と効果の説明
  /**
   * 進捗のスコープ。
   * - "loop":   1周回ごとにリセットされるカウンタ（例: 1ループ中に share×3）
   * - "career": 周回をまたいで貯まるカウンタ（例: 通算 forage×30）
   */
  scope: "loop" | "career";
  threshold: number; // この値に達したら習得
  /** その日の進捗増分を返す（0 なら寄与なし） */
  measure: (ctx: SkillTickContext) => number;
  effect: SkillEffectRaw; // 習得後に効く効果
}

/** スキルの保有・進捗状態（Chronicle が持つ） */
export interface SkillProfile {
  acquired: SkillId[]; // 習得済みスキル
  progress: Record<SkillId, number>; // 各スキルの進捗カウンタ
}

/** 1周回の結末の記録（履歴・あらすじ素材） */
export interface LoopSummary {
  loop: number; // 何周目か
  days: number; // ハルが生きた日数
  causeOfEnd: string; // 終わり方（死因・状況）
  altruismReached: number; // その周でハルの利他が届いた最大値
  stageReached: Stage; // その周で届いた最高段階（成長軸）
  acquiredSkills: SkillId[]; // その周で会得したスキル
}

/**
 * 回帰をまたいで生き残るメタ状態。WorldState の外（上位の層）に置き、
 * 周回ごとに WorldState を作り直しても保持される。
 */
export interface Chronicle {
  loop: number; // 現在の周回数（1 始まり）
  protagonistId: string; // 主人公の id（"haru" 固定）
  skills: SkillProfile;
  /**
   * 恒久ロスター。世界に登場するキャラの id。初期は ["haru"] だけ。
   * ハルの成長・スキル達成で解放されたキャラが加わり、次に回帰した周の Day1 から登場する。
   */
  roster: string[];
  /** ハルがこれまでの全周で到達した利他の最大値（キャラ解放条件の判定に使う） */
  heroPeakAltruism: number;
  history: LoopSummary[]; // 過去の周回の結末
}
