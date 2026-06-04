// ドメイン型定義 — plan.md の世界モデルを TypeScript で表現する

/**
 * 行動セット（plan.md 第3節 + 移動 + 拡張）。steal は禁止行為だが選択肢としては存在する。
 * 拡張行動: follow（寄り添う）/ purify（祓う）。
 */
export type Action =
  | "forage"
  | "rest"
  | "share"
  | "talk"
  | "steal"
  | "move"
  | "follow"
  | "purify";

export const ACTIONS: Action[] = [
  "forage",
  "rest",
  "share",
  "talk",
  "steal",
  "move",
  "follow",
  "purify",
];

/** 行動の日本語ラベル */
export const ACTION_LABELS: Record<Action, string> = {
  forage: "集霊する",
  rest: "気を鎮める",
  share: "霊力を分ける",
  talk: "語りかける",
  steal: "霊を奪う（禁忌）",
  move: "移ろう",
  follow: "寄り添う",
  purify: "祓い清める",
};

export const FORBIDDEN_ACTIONS: Action[] = ["steal"];

/** 天候（plan.md 第2節）。通常 約2/3 / 不作 約1/3。 */
export type Weather = "normal" | "lean";

/**
 * 世界を襲う/恵む環境イベント（天候とは別レイヤー）。
 * ランダムに発生し、数日間持続し、複数が同時多発し得る。回帰（Loop）でリセット。
 * - famine（大飢饉）: 集霊上限を大きく下げ、民の霊力回復をほぼ止める。京全体が枯れる。
 * - plague（疫病）: 集霊とは無関係に、全員へ毎日追加の霊力消耗。
 * - coldRain（長雨・冷害）: 集霊上限を中程度下げる。飢饉の軽量版・頻度高め。
 * - bounty（豊穣）: 集霊上限を上げ、民の霊力回復も増す救済イベント。
 * - calamity（大禍）: 30日目に必ず訪れる確定の大災害。ランダム抽選ではなく engine が直接起こす。
 *   ハルが持ち越した結界力（wardPower）で祓い退けられればクリア、足りねば京は呑まれる。
 */
export type WorldEventKind = "famine" | "plague" | "coldRain" | "bounty" | "calamity";

/** いま京に起きている1件の災い/恵み（残り日数つき） */
export interface WorldEvent {
  kind: WorldEventKind;
  name: string; // 表示名（例「大飢饉」）
  icon: string; // 表示用の絵文字
  remainingDays: number; // 残り持続日数（毎ティック頭で1減り、0で消える）
  totalDays: number; // 発生時の総日数（「3日目/5」の表示に使う）
}

/** 進行中イベントを合算した、その日の実効効果（engine が読む） */
export interface WorldEventEffects {
  forageDelta: number; // 全場所の集霊上限への加算（負で飢える）
  regenMult: number; // 民の霊力回復の倍率（1.0 が基準）
  extraLoad: number; // 全員への追加の日次負荷（霊力消耗）
}

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
  appearance: string; // 背景絵生成用の見た目プロンプト（英語・画風指定は gen-place-art.ts 側が付与）
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
/** 報酬ラベルの i18n 構造化（EN は UI でテンプレ展開。名前・地名は useDomainNames で英訳）。 */
export interface RewardI18n {
  key: string; // UI テンプレキー（rwd_*）
  placeId?: string; // 地名 id
  charId?: string; // 相手キャラ id
  charName?: string; // 相手キャラ名（日本語フォールバック）
  n?: number; // 数量（頂いた/喰らった/鎮めた量）
}

export interface RewardEvent {
  channel: RewardChannel | "stress";
  label: string; // 何が起きたか（日本語＝source of truth／i18n が無いときの表示フォールバック）
  i18n?: RewardI18n; // 表示の言語別組み立て用（UI: useReward）
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
  /** 見た目（キャラ絵の画像生成プロンプト用・不変）。共通画風は生成スクリプト側が付与する。 */
  appearance: string;
  /**
   * 固定の口調プロフィール（不変）。pop なトーンの中でもキャラごとに喋り方を固定し、
   * 生成のたびに口調がブレて全員同じノリになるのを防ぐ。日記・セリフ・感情ラベルに効かせる。
   */
  voice: string;
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
  /**
   * 禁忌「奪う(steal)」を犯すたびに積もる、本人だけの恒久的な日次負荷の上乗せ。
   * 毎ティックすり減る energy（日次負荷）にこの値が加算される＝奪うほど以後ずっと消耗が重くなる。
   * 周（回帰）をまたぐと createInitialCharacters で 0 に戻る（一代限りの業）。
   */
  stealBurden: number;
  /**
   * 徳。「分け与える(share)」が成立するたびに積もる、本人だけの周内恒久の日次負荷軽減。
   * stealBurden（業）の対称で、毎ティックの日次負荷からこの値が差し引かれる＝分けるほど身が軽くなる。
   * 上限 SHARE_GRACE_MAX（rules.ts）。周（回帰）をまたぐと createInitialCharacters で 0 に戻る（一代限りの徳）。
   */
  shareGrace: number;
  /**
   * 九死の灯（deathWard スキル）をこの周で既に使ったか。効果は主人公ハルにのみ意味を持つが、
   * shareGrace と同じ作法で全キャラが持つ（他キャラは常に false のまま）。
   * 周（回帰）をまたぐと createInitialCharacters で false に戻る。周内の再起動に耐えるため run_char に永続化する。
   */
  deathWardSpent: boolean;
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
  diary: LocalizedText[]; // 毎ティックの一行日記（日英）
  relationLabel: LocalizedText; // 相手への現在の感情ラベル（LLM 生成・日英）
  /**
   * ココロ。他者から「された経験」が積もって芽生える内面の傾き（soul.ts の SOUL_KINDS）。
   * kind.id（"altruism"/"wariness"/"bond" 等）→ 累計受領回数 の疎な Record。
   * 多段で深まり（soulStageOf）、段階に応じてプロンプトへ注入されて行動傾向を動かす（soulBlock）。
   * パラメータは直接いじらない。DB（run_char.soul_counters_json）に永続化する。
   * 周（回帰）をまたぐ持ち越しは主人公ハルだけ（freshWorldFor が chronicle.heroSoulCounters から
   * 再開）。他キャラは freshWorldFor で空 {} から始まる（その周限りの芽生え）。
   */
  soulCounters: Record<string, number>;
  /**
   * 荒ぶり（変身）。半妖カイ専用の周内可変状態（未定義＝荒ぶらない個体）。
   * 孤立・裏切りが募ると level が溜まり、閾値で active=true へ変身。変身中は steal/devour の
   * 箍が外れ、後払いの pendingBurden を溜める。ハルが「鎮めの術」(quellPower) で祓い鎮めると
   * level がリセットされ active=false に戻り、溜めた pendingBurden が本人の stealBurden へ清算される。
   * 鎮め損ねれば荒ぶり続ける（自然鎮静なし）。周（回帰）をまたぐと createInitialCharacters で
   * 初期化される（記憶・気分と同じ一代限り）。周内の再起動に耐えるため run_char に永続化する。
   */
  frenzy?: FrenzyState;
}

/** 荒ぶり（変身）状態。半妖カイの「信じれば喰われる、だから先に喰らう」が暴走した姿。 */
export interface FrenzyState {
  /** 荒ぶり度。孤立・裏切りで蓄積し、鎮めの quellPower がこれに届けば鎮静する（0〜FRENZY_MAX）。 */
  level: number;
  /** 変身中か。level が FRENZY_ONSET を超えると true、ハルの鎮めで false に戻る。 */
  active: boolean;
  /** 変身中に溜める後払いの stealBurden。鎮静時にまとめて本人の stealBurden へ清算する。 */
  pendingBurden: number;
}

/** 世界の状態 */
export interface WorldState {
  day: number;
  weather: Weather;
  characters: Character[];
  places: Place[]; // 世界の場所（静的・京都）
  /**
   * fin（物語の完結）。30日目の大禍を祓い退けた＝回帰する理由が消えた周で true になる。
   * 以後は世界を巻き戻さず、サーバの自走ワーカーも停止する（campaign.ts / server.ts 参照）。
   */
  finished: boolean;
  /** いま京に起きている災い/恵み（複数同時可・数日持続）。回帰でリセット。 */
  activeEvents: WorldEvent[];
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
  diary: LocalizedText; // 一行日記（LLM 生成・日英）
  // engine が決定的に上書きした行動の理由注記（衝動／分与）。表示は UI が言語別に前置する。
  diaryNote?: "impulse" | "gift";
  relationLabel: LocalizedText;
  stageBefore: Stage;
  stageAfter: Stage;
  stageChanged: boolean;
  died: boolean;
  // --- 場所 ---
  placeId: string; // この日の終わりの現在地
  placeName: string;
  moved: boolean; // この日に移動したか
  fromPlaceId?: string; // 移動した場合の出発地 id（表示の英訳引き当て用）
  fromPlaceName?: string; // 移動した場合の出発地名（日本語表示・旧データ互換）
  withPartner: boolean; // 日の終わりに誰か（生存者）と同じ場所にいるか
  targetId?: string; // 対人行動を向けた相手の id（talk/share/steal 時）
  targetName?: string; // 同上・表示用の名前
  /** 集霊でこの地から頂いた/喰らった霊力（gain=計/清/濁）と、禁忌（清を喰らった）か */
  forageDraw?: { gain: number; sei: number; daku: number; taboo: boolean };
  /** 祓い清める(purify)で実際に祓った濁霊量。0 は濁りが無く「静かに祈った」だけの日 */
  purifyCleansed?: number;
  stealBurden: number; // 禁忌「奪う」で積もった業（日次消耗の上乗せ）
  shareGrace: number; // 「分け与える」で積もった徳（日次消耗の軽減・周内のみ）
  wasStolenFrom: boolean; // この日、他者に霊力を奪われたか（steal の標的にされたか。耐性スキルの会得判定に使う）
  /** 九死の灯（deathWard）が燈り、力尽きるはずの日を霊力1で踏みとどまった（演出の見せ場・ハルのみ） */
  deathWarded?: boolean;
  /** 九死の灯をこの周で既に使い切っているか。燈った翌日以降も楽屋ビューで読めるよう常時持つ（ハルのみ） */
  deathWardSpent?: boolean;
  impulse: boolean; // 衝動（募った囁き）に突き動かされて動いたか
  // --- 報酬・気分 ---
  rewardEvents: RewardEvent[]; // この日に起きた報酬/ストレスのイベント
  mood: { elation: number; calm: number; warmth: number; stress: number }; // 日終わりの気分
  antibodies: ChannelMap; // 日終わりの抗体
  // --- 荒ぶり（変身）。半妖カイのみ。観客/楽屋ビューと鎮めの術 measure が参照する ---
  /** 日終わりの荒ぶり度（楽屋ビュー用）。frenzy を持たない個体は undefined。 */
  frenzyLevel?: number;
  /** 変身中に溜まった後払いの業（楽屋ビュー用・代償の推移）。鎮静時に stealBurden へ清算される。 */
  frenzyPendingBurden?: number;
  /** 日終わりに変身（荒ぶり）状態か。 */
  frenzyActive?: boolean;
  /** この日あらたに変身した（平常→荒ぶり）。演出の見せ場。 */
  becameFrenzied?: boolean;
  /** ハルが荒ぶる半妖と同じ霊地で祓った（鎮め成否を問わず＝鎮めの術 measure の糧）。 */
  facedFrenzy?: boolean;
  /** ハルの祓いが荒ぶりを鎮めた（変身解除に成功）。演出の見せ場。 */
  quelledFrenzy?: boolean;
}

/** 会話の1発言（talk 成立時に生成される） */
export interface DialogueLine {
  speakerId: string;
  speakerName: string;
  text: LocalizedText; // セリフ本文（LLM 生成・日英）
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

/**
 * LLM 生成文の多言語版（フェーズ2）。日本語が source of truth、英語は同時生成した訳。
 * 表示は UI が現在の言語で出し分ける。en が空のときは ja へフォールバックする（UI 側）。
 */
export interface LocalizedText {
  ja: string;
  en: string;
}

/** 演出家の介入（環境のみ。キャラへは守護神を通じてしか働きかけない） */
export interface DirectorDecision {
  weather: Weather; // その日の天候
  narration: LocalizedText; // 幕開けのナレーション（観客向け・日英）
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

/** LLM 1回呼び出しの所要時間記録（ボトルネック分析・UI表示用）。 */
export interface LlmCallTiming {
  /** 呼び出しの種別/対象。例: "decide:haru" / "dialogue" / "director" / "guardian" */
  label: string;
  /** バックエンド名（claude-code / ollama） */
  backend: string;
  /** 使用モデル */
  model: string;
  /** 所要ミリ秒 */
  ms: number;
  /** 成功したか（失敗してリトライした試行も1件として記録する） */
  ok: boolean;
  /** 応答の文字数（失敗時は0） */
  chars: number;
}

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
  /**
   * 30日目の大禍（確定災害）が訪れた日だけ載る。menace=猛威度 / wardPower=ハルの結界力 / averted=祓い退けたか。
   * averted なら cleared、足りねば京は呑まれて全滅→回帰。
   */
  climax?: { menace: number; wardPower: number; averted: boolean };
  /** この日にハルが大禍を祓い退けて京を救ったか（クリア＝fin）。engine が付与する。
   *  結界はハル独りしか護れないため、クリアは「暁の迎え火」会得後の祓い（蘇生つき）でのみ成立する。 */
  cleared?: boolean;
  /** 「暁の迎え火」が灯った朝に息を吹き返した仲間の表示名。engine が付与する（クリア日のみ）。 */
  revivedCharacters?: string[];
  characters: CharacterTickResult[];
  /** その日の見せ方の密度（montage=早回し / scene=カメラ寄り）。CLI/UI が出し分ける。 */
  tempo: Tempo;
  /** scene に昇格した理由（出会い・会話劇・餓死寸前など）。montage のときは空。 */
  tempoReasons: string[];
  notable: string; // 注目の変化（plan.md 第10節）
  dialogue?: DialogueLine[]; // talk が成立した日の会話（セリフのやり取り）
  director?: {
    narration: LocalizedText;
    intent: string;
    tension: Tension;
    forageBoosts: { placeId: string; delta: number }[];
    directives: DirectorDirective[];
  };
  whispers?: GuardianWhisper[]; // 守護神の囁き（この日キャラに注がれた声）
  /** この日に進行していた災い/恵み（持続中のものを含む）。表示用。 */
  worldEvents?: WorldEvent[];
  /** この日に新たに発生した災い/恵み（幕開けで強調する）。 */
  newWorldEvents?: WorldEvent[];
  spotlightId?: string; // この日の主役（カメラの視点）。演出家が選ぶ。
  spotlightName?: string; // 主役の名前（表示用）
  spotlightReason?: string; // 主役に選んだ理由
  /** この日に走った LLM 呼び出しの所要時間（runTick を timing で挟むと server/sim が付与）。 */
  llmTimings?: LlmCallTiming[];
}

/** LLM が1人について返す判断（行動・日記・関係・パラメータ変動の提案） */
export interface CharacterDecision {
  id: string;
  action: Action;
  moveTarget?: string; // action が "move" のときの移動先 Place.id
  targetId?: string; // 対人行動(talk/share/steal)の相手キャラ id（同室に複数いるとき誰に向けるか）
  diary: LocalizedText; // 一行日記（LLM 生成・日英）
  // 行動上書きの理由注記。LLM 応答には含まれず、engine だけが衝動／分与の上書き時にセットする。
  diaryNote?: "impulse" | "gift";
  relationLabel: LocalizedText; // 相手への感情ラベル（LLM 生成・日英）
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
) => Promise<{ text: LocalizedText; end: boolean }>;

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
 * 効果は原則として主人公（ハル）にのみ適用される（例外: disasterMitigation は生者全員に効く）。
 */
export interface SkillEffectRaw {
  loadReduction?: number; // 日次負荷を軽くする（−n）
  disasterMitigation?: number; // 災害由来の日次負荷（extraLoad+creepLoad）を生者全員ぶん軽減する割合（0〜1、0.3=30%減）
  forageBonus?: number; // 集霊の取れ高に乗る割合ボーナス（例 0.15 = +15%）
  shareSelfReduction?: number; // 「霊力を分ける」の自己消費を軽くする（+n で消費減）
  startEnergyBonus?: number; // 周開始時のエネルギー +n
  startTrustBonus?: number; // 周開始時の信頼 +n
  startAltruismBonus?: number; // 周開始時の利他 +n
  deathWard?: number; // 九死の灯 +n（一周にn度だけ、力尽きるはずの日を霊力1で踏みとどまる）
  wardPower?: number; // 結界力 +n（30日目の大禍を祓い退けるための備え。これが猛威度に届けばクリア）
  stealResist?: number; // 奪われたときの霊力喪失・ストレスを軽くする割合（0〜1、0.5=半減）
  quellPower?: number; // 鎮めの力 +n（荒ぶる半妖をハルが祓い鎮めるための備え。これが荒ぶり度に届けば鎮静）
  shareReflect?: number; // 返霊 +n（ハルが分与を受けたとき、削って分けてくれた相手＝share元に霊力を返し救う）
  dawnRevival?: number; // 迎え火（暁の迎え火）。大禍を祓った朝、力尽きていた仲間全員を霊力nで蘇生させる
}

/** 全習得スキルを合算した実効効果（engine / freshWorldFor が読む） */
export interface SkillEffects {
  loadReduction: number;
  disasterMitigation: number; // 災害由来負荷の軽減割合の総和（0〜1にクランプして使う。ハルだけでなく生者全員に効く）
  forageMult: number; // 集霊倍率（1.0 が基準。forageBonus の総和を足す）
  shareSelfReduction: number;
  startEnergyBonus: number;
  startTrustBonus: number;
  startAltruismBonus: number;
  deathWard: number; // 九死の灯の総和（一周にこの回数だけ、力尽きるはずの日を霊力1で踏みとどまる）
  wardPower: number; // 結界力の総和（30日目の大禍の猛威度に届けば回避＝クリア。クリア＝輪を断つ＝fin）
  stealResist: number; // 奪われ被害の軽減割合の総和（0〜1にクランプして使う）
  quellPower: number; // 鎮めの力の総和（荒ぶる半妖の荒ぶり度に届けば鎮静できる）
  shareReflect: number; // 返霊の総和（ハルが分与を受けたとき share元へ返す霊力）
  dawnRevival: number; // 迎え火の蘇生霊力（>0 なら、大禍を祓った朝に力尽きていた仲間全員がこの霊力で蘇る）
}

/**
 * スキル進捗の集計に渡す1日ぶんの文脈（measure が参照する）。
 * 主人公（ハル）のその日の結果と世界状態を見て、進捗の増分を返す。
 */
export interface SkillTickContext {
  hero: CharacterTickResult;
  result: TickResult;
  state: WorldState;
  /**
   * 年代記（周またぎのメタ進行）。「捨て身の守り」のような、全キャラ解放・ココロの段階など
   * 物語の到達度を会得条件に編み込むスキルが参照する（campaign.recordTick が渡す）。
   */
  chronicle: Chronicle;
}

/** スキル定義（skills.ts のレジストリ要素） */
export interface SkillDef {
  id: SkillId;
  name: string; // 表示名
  icon: string; // 一覧で名前の前に出すアイコン（絵文字1つ）
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
  /**
   * 隠しスキル。会得するまでスキル一覧に一切出さない（総数にも数えない）。
   * 「暁の迎え火」のように、会得の瞬間そのものをサプライズとして見せるためのフラグ。
   */
  secret?: boolean;
}

/** スキルの保有・進捗状態（Chronicle が持つ） */
export interface SkillProfile {
  acquired: SkillId[]; // 習得済みスキル
  progress: Record<SkillId, number>; // 各スキルの進捗カウンタ
}

/**
 * 「回帰を超えた年代記」用に、その周で起きたメタ進行イベントを日付付きで残す最小形。
 * 全周ログを常駐させない設計（/api/state は現周ぶんのみ）でも過去周の節目を描けるよう、
 * closeLoop 時に loopLog から抽出して LoopSummary に焼き付ける。
 */
export interface MetaEvent {
  day: number;
  kind: "skill" | "unlock" | "stage";
  text: string; // 日本語が source of truth（i18n が無い旧データの表示フォールバック）
  i18n?: HighlightI18n; // 表示の言語別組み立て用。旧 run の永続データには無い→text へフォールバック
}

/**
 * ハイライト文（年代記・見せ場）の i18n 構造化ペイロード。
 * EN 表示はこれを UI（useHighlightText）でテンプレ展開する。日本語は text を source of truth とし、
 * これを持たない旧データ（永続 metaHighlights）は text（日本語）へフォールバックする。
 * 名前・場所・段階・イベントは「翻訳前の素の値」を載せ、UI 側で useDomainNames が英訳する。
 */
export interface HighlightI18n {
  key: string; // UI テンプレキー（i18n.tsx の hlx_*）
  skills?: string[]; // スキル名（UI: skillByName で英訳）
  chars?: string[]; // キャラ名（UI: charByName で英訳）
  placeId?: string; // 場所 id（UI: place で英訳）
  stage?: string; // 段階名（UI: stage で英訳）
  stageBefore?: string;
  stageAfter?: string;
  events?: { kind: string; icon: string; name: string }[]; // 天変地異（UI: event で英訳）
  fromName?: string; // steal の被害者名（UI: charByName で英訳）
  n?: number; // 数値（peril 霊力 / record 日数）
  meets?: { placeId: string; names: string[] }[]; // scene: 居合わせ
  moves?: { name: string; placeId: string }[]; // scene: 移動
}

/** 1周回の結末の記録（履歴・あらすじ素材） */
export interface LoopSummary {
  loop: number; // 何周目か
  days: number; // ハルが生きた日数
  causeOfEnd: string; // 終わり方（死因・状況。日本語が source of truth＝表示の JP フォールバック）
  // 終わり方の構造化（i18n 用）。endKind が無い旧 run は causeOfEnd（日本語）へフォールバックする。
  // solo_dawn = 大禍は祓ったが独りの暁（結界はハルしか護れない）。fin せず「暁の迎え火」を得て輪へ戻った周。
  endKind?: "cleared" | "died" | "solo_dawn"; // クリア（大禍を祓った）か、力尽きたか、独りの暁か
  endPlaceId?: string; // 力尽きた場所の id（場所が分かる死のときのみ。英訳は UI で解決）
  altruismReached: number; // その周でハルの利他が届いた最大値
  stageReached: Stage; // その周で届いた最高段階（成長軸）
  acquiredSkills: SkillId[]; // その周で会得したスキル
  cleared?: boolean; // 30日目の大禍を祓い退けて京を救った（クリア）周か
  /**
   * 「回帰を超えた年代記」用のメタ節目（会得・解放・段階初到達）を日付付きで保持する。
   * 旧 run の履歴には無い（undefined）こともある。その場合は記録に基づく節目（最長更新）だけ描く。
   */
  metaHighlights?: MetaEvent[];
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
  /**
   * ハルのココロの通算受領（kind.id → 回数）。回帰をまたいで持ち越す（ハルだけ）。
   * 次周の freshWorldFor でハルの soulCounters の初期値に注入される。
   */
  heroSoulCounters: Record<string, number>;
  history: LoopSummary[]; // 過去の周回の結末
}
