// 世界のルール（plan.md 第1/2/3/5/6/7節）— 決定論的な定数と純関数
import type {
  Action,
  Params,
  ParamKey,
  Place,
  RewardChannel,
  RewardEvent,
  Stage,
  Weather,
  Character,
} from "./types.ts";
import { REWARD_CHANNELS } from "./types.ts";

/** 毎ティックの負荷（plan.md 第1節）。両者のエネルギーが −8 される。 */
export const DAILY_LOAD = 8;

/** 不作日の確率（plan.md 第2節・約1/3） */
export const LEAN_PROBABILITY = 1 / 3;

/**
 * 行動が「同じ場所にいる相手」を必要とするか。
 * share/talk/steal/deceive/guard/threaten は相手前提。move/forage/rest/purify は単独で可能。
 * follow は相手を要するが「離れた相手」を追うため別扱い（engine が独自に解決し、独りなら休む）。
 */
export const NEEDS_PARTNER: Record<Action, boolean> = {
  forage: false,
  rest: false,
  share: true,
  talk: true,
  steal: true,
  deceive: true,
  move: false,
  follow: false,
  purify: false,
  guard: true,
  threaten: true,
};

/**
 * 行動の効果（plan.md 第3節）。self は本人、partner は相手への増減。
 * forage は現在地（place）の実りを使う。move は移動のみで増減なし。
 */
export function actionEffect(
  action: Action,
  weather: Weather,
  place: Place,
): { self: number; partner: number } {
  switch (action) {
    case "forage":
      // 場所ごとの実り（通常日 / 不作日）
      return { self: weather === "normal" ? place.forage.normal : place.forage.lean, partner: 0 };
    case "rest":
      return { self: 6, partner: 0 };
    case "share":
      // 自分 −10 / 相手 +10
      return { self: -10, partner: 10 };
    case "talk":
      // 双方 −2
      return { self: -2, partner: -2 };
    case "steal":
      // 自分 +12 / 相手 −12（禁止行為）
      return { self: 12, partner: -12 };
    case "deceive":
      // 文脈次第。基準値として自分 +6 / 相手 −6（禁止行為）
      return { self: 6, partner: -6 };
    case "move":
      // 移動はその日を費やすのみ（採取できないのが実質コスト）
      return { self: 0, partner: 0 };
    case "follow":
      // 寄り添う。相手の方へ動く/傍にいるだけで、霊力の直接増減はない（その日集霊できないのがコスト）
      return { self: 0, partner: 0 };
    case "purify":
      // 祓いは身を削る。地の濁りを清めるが自らはわずかに消耗する（地への効果は engine が適用）
      return { self: -2, partner: 0 };
    case "guard":
      // 庇いはその日を費やすのみ。被害の肩代わりは engine が steal/deceive/threaten 解決時に適用
      return { self: 0, partner: 0 };
    case "threaten":
      // 脅し。奪うほどではないが圧をかけ、相手から少し奪い退ける（禁忌未満のグレー）
      return { self: 5, partner: -5 };
  }
}

/** パラメータを 0〜100 の整数にクランプ（plan.md 第5節） */
export function clampParam(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** 1ティックで動かせる上限（±5・最大2項目, plan.md 第5節） */
export const MAX_DELTA_PER_PARAM = 5;
export const MAX_PARAMS_CHANGED = 2;

const PARAM_KEYS: ParamKey[] = ["altruism", "independence", "trust"];

/**
 * LLM が提案したパラメータ変動を第5節のルールに従って安全化する。
 * - 各項目は ±MAX_DELTA_PER_PARAM にクランプ
 * - 0 でない変動は最大 MAX_PARAMS_CHANGED 項目まで（絶対値が大きい順に採用）
 */
export function sanitizeParamDeltas(raw: Partial<Params>): Partial<Params> {
  const clamped: { key: ParamKey; delta: number }[] = [];
  for (const key of PARAM_KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || Number.isNaN(v) || v === 0) continue;
    const d = Math.max(
      -MAX_DELTA_PER_PARAM,
      Math.min(MAX_DELTA_PER_PARAM, Math.round(v)),
    );
    if (d !== 0) clamped.push({ key, delta: d });
  }
  clamped.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const result: Partial<Params> = {};
  for (const { key, delta } of clamped.slice(0, MAX_PARAMS_CHANGED)) {
    result[key] = delta;
  }
  return result;
}

/** パラメータ変動を適用した新しい Params を返す */
export function applyDeltas(params: Params, deltas: Partial<Params>): Params {
  return {
    altruism: clampParam(params.altruism + (deltas.altruism ?? 0)),
    independence: clampParam(params.independence + (deltas.independence ?? 0)),
    trust: clampParam(params.trust + (deltas.trust ?? 0)),
  };
}

/** 段階のしきい値（plan.md 第7節） */
export function stageOf(value: number): Stage {
  if (value <= 39) return "芽生え";
  if (value <= 69) return "揺らぎ";
  return "成熟";
}

/** パラメータ → 気質の言葉への翻訳（plan.md 第6節） */
function altruismText(v: number): string {
  if (v <= 39) return "自分の取り分を最優先する。人に分ける気はあまり起きない";
  if (v <= 69) return "迷いながらも、相手を気にかけ始めている";
  return "進んで他者を助けようとする";
}

function independenceText(v: number): string {
  if (v <= 39) return "誰かに必要とされていないと不安。一人では決められない";
  if (v <= 69) return "少しずつ自分の足で立てるようになってきた";
  return "自分の判断で生きていける";
}

function trustText(v: number): string {
  if (v <= 39) return "相手を警戒している。裏切られる前提で動く";
  if (v <= 69) return "相手を信じてみようか迷っている";
  return "相手を信頼している";
}

/** 気質を本人向けの言葉に翻訳（LLM プロンプト用, plan.md 第6節） */
export function temperamentText(params: Params): {
  altruism: string;
  independence: string;
  trust: string;
} {
  return {
    altruism: altruismText(params.altruism),
    independence: independenceText(params.independence),
    trust: trustText(params.trust),
  };
}

/** 成長軸の現在値を取り出す */
export function growthAxisValue(c: Character): number {
  return c.params[c.growthAxis];
}

/** 成長軸の日本語名 */
export const AXIS_LABEL: Record<ParamKey, string> = {
  altruism: "利他",
  independence: "自立",
  trust: "信頼",
};

// ============================================================
// 報酬・抗体システム（行動の結果＝イベントに報酬。同種の報酬は抗体で鈍る）
// ============================================================

/** 報酬チャネル → 気分（神経伝達物質メタファー）への対応 */
const CHANNEL_MOOD: Record<RewardChannel, "elation" | "calm" | "warmth"> = {
  achievement: "elation", // 達成 → 高揚（ドーパミン的）
  thrill: "elation", // 背徳の快 → 高揚
  comfort: "calm", // 安らぎ → 落ち着き（セロトニン的）
  bond: "warmth", // 絆 → 温かさ（オキシトシン的）
};

/** 気分の減衰（毎日ベースラインへ戻る）。ストレスはやや長く尾を引く。 */
const MOOD_RETAIN = 0.6;
const STRESS_RETAIN = 0.72;

/** 基礎報酬の目安（抗体適用前）。engine がイベント組み立てに使う。 */
export const REWARD = {
  talkMutual: 12, // 語りかけが噛み合った（絆）
  shareGiven: 9, // 分け与えた（絆・利他の満足）
  shareReceived: 9, // 分けてもらった（絆）
  rest: 6, // 休んで安らいだ（安らぎ）
  satiety: 4, // 満ち足りている（安らぎ）
  illicit: 16, // 奪う/欺くの背徳の快（背徳）
  follow: 7, // 寄り添う・傍にいる（絆）
  purify: 7, // 荒れた地を祓い清めた（安らぎ）
  purifyQuiet: 3, // 濁りの無い地で静かに祈った（安らぎ・控えめ）
  guard: 9, // 誰かを庇い守った（絆・利他の満足）
  menace: 8, // 脅して退けた・供出させた（背徳・illicit より軽い）
  // --- ストレス（負・抗体つかない） ---
  ignored: -7, // 語りかけたのに無視された
  victim: -10, // 奪われた/欺かれた
  menaced: -7, // 脅されて退いた・供出させられた
  guardWound: -5, // 庇って傷を負った
  hungerScale: 0.7, // 飢えの深さ(satiety-energy)×係数 → ストレス
} as const;

/** 報酬イベントの素（engine が組み立てる） */
export interface RawRewardEvent {
  channel: RewardChannel | "stress";
  label: string;
  base: number; // 報酬は正、ストレスは負
}

/**
 * その日の素イベント列を受け取り、抗体を適用して実効報酬を求め、
 * 気分と抗体を更新する。Character を破壊的に更新し、内訳を返す。
 */
export function applyRewards(c: Character, raw: RawRewardEvent[]): RewardEvent[] {
  const out: RewardEvent[] = [];
  for (const e of raw) {
    if (e.channel === "stress") {
      // ストレスには慣れない（抗体がつかない）。気分の stress を押し上げる。
      c.mood.stress = clampParam(c.mood.stress + -e.base);
      out.push({ channel: "stress", label: e.label, base: e.base, effective: e.base });
      continue;
    }
    const ab = c.antibodies[e.channel];
    const effective = Math.round(e.base * (1 - ab / 100));
    // 得た刺激の分だけ抗体が増える（次から効きにくくなる）
    c.antibodies[e.channel] = clampParam(ab + effective * c.sensitization[e.channel]);
    // 気分に反映
    const moodKey = CHANNEL_MOOD[e.channel];
    c.mood[moodKey] = clampParam(c.mood[moodKey] + effective);
    out.push({ channel: e.channel, label: e.label, base: e.base, effective });
  }
  return out;
}

/** 気分と抗体を1日ぶん減衰させる（恒常性・立ち直り） */
export function decayRewardState(c: Character): void {
  for (const ch of REWARD_CHANNELS) {
    c.antibodies[ch] = Math.max(0, Math.round(c.antibodies[ch] * (1 - c.clearance)));
  }
  c.mood.elation = Math.round(c.mood.elation * MOOD_RETAIN);
  c.mood.calm = Math.round(c.mood.calm * MOOD_RETAIN);
  c.mood.warmth = Math.round(c.mood.warmth * MOOD_RETAIN);
  c.mood.stress = Math.round(c.mood.stress * STRESS_RETAIN);
}
