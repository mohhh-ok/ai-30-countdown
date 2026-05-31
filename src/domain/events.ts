// 環境イベント（災い/恵み）— 天候とは別レイヤーの、ランダムに湧いて数日続く世界の波。
// 「時々の大飢饉」で連戦の合間に死を呼び込み、豊穣で緩める。複数同時多発し得る。
// 効果はすべて環境（集霊上限・民の霊力回復・全員の消耗）に作用し、キャラの芯には触れない。
import type {
  WorldEvent,
  WorldEventEffects,
  WorldEventKind,
  WorldState,
} from "./types.ts";

/** 1種類のイベントの定義（レジストリ要素） */
interface WorldEventDef {
  kind: WorldEventKind;
  name: string; // 表示名
  icon: string; // 表示用絵文字
  /** 演出家プロンプトに渡す一文（どんな災い/恵みか） */
  blurb: string;
  /** 1日あたりの発生確率（既に同種が起きていない日に抽選） */
  dailyChance: number;
  /** 持続日数の範囲 [min, max]（発生時に抽選） */
  duration: [number, number];
  /** この1件がもたらす効果（複数同時なら aggregate で合算） */
  effects: WorldEventEffects;
}

/**
 * イベント定義のレジストリ。負イベント中心（ハルを死に追い込む）に、救済の豊穣を一枚。
 * 確率・効果はここを触れば調整できる単一の場所。
 */
export const WORLD_EVENTS: WorldEventDef[] = [
  {
    kind: "famine",
    name: "大飢饉",
    icon: "🍂",
    blurb: "大飢饉。京の実りは枯れ果て、民の霊力も湧かない。集霊はほとんど望めない。",
    dailyChance: 0.04,
    duration: [3, 5],
    effects: { forageDelta: -7, regenMult: 0.2, extraLoad: 0 },
  },
  {
    kind: "plague",
    name: "疫病",
    icon: "🦠",
    blurb: "疫病が京に広がる。実りに関わらず、生ける者の霊力が日ごとに削られていく。",
    dailyChance: 0.045,
    duration: [2, 4],
    effects: { forageDelta: 0, regenMult: 1, extraLoad: 4 },
  },
  {
    kind: "coldRain",
    name: "長雨・冷害",
    icon: "🌧️",
    blurb: "長雨と冷えが続く。実りは細り、集霊の手応えが鈍い。",
    dailyChance: 0.08,
    duration: [2, 3],
    effects: { forageDelta: -3, regenMult: 0.6, extraLoad: 0 },
  },
  {
    kind: "bounty",
    name: "豊穣",
    icon: "🌾",
    blurb: "豊穣の気が満ちる。実りは増し、民の霊力も豊かに湧き出る。",
    dailyChance: 0.06,
    duration: [2, 3],
    effects: { forageDelta: 5, regenMult: 1.6, extraLoad: 0 },
  },
];

const EVENT_BY_KIND = new Map(WORLD_EVENTS.map((d) => [d.kind, d]));

/** 効果なしの中立値（イベントが何も無い日） */
export function noEventEffects(): WorldEventEffects {
  return { forageDelta: 0, regenMult: 1, extraLoad: 0 };
}

/**
 * 進行中イベントの残り日数を1日減らし、尽きたものを取り除く（破壊的）。
 * 毎ティックの頭、新規抽選より前に呼ぶ。発生日は減らさず、翌日から数える。
 */
export function decayEvents(state: WorldState): void {
  for (const e of state.activeEvents) e.remainingDays -= 1;
  state.activeEvents = state.activeEvents.filter((e) => e.remainingDays > 0);
}

/**
 * その日の新規イベントをランダムに発生させる（破壊的に activeEvents へ追加）。
 * 各種を独立に抽選するので複数同時多発し得る。既に同種が進行中なら重ねない。
 * 発生したイベントの配列を返す（幕開けの強調用）。
 */
export function rollNewEvents(state: WorldState, rng: () => number): WorldEvent[] {
  const active = new Set(state.activeEvents.map((e) => e.kind));
  const spawned: WorldEvent[] = [];
  for (const def of WORLD_EVENTS) {
    if (active.has(def.kind)) continue;
    if (rng() >= def.dailyChance) continue;
    const [min, max] = def.duration;
    const days = min + Math.floor(rng() * (max - min + 1));
    const ev: WorldEvent = {
      kind: def.kind,
      name: def.name,
      icon: def.icon,
      remainingDays: days,
      totalDays: days,
    };
    state.activeEvents.push(ev);
    spawned.push(ev);
  }
  return spawned;
}

/** 進行中イベント全件の効果を合算する（forage/extraLoad は加算、regen は乗算）。 */
export function aggregateEventEffects(events: WorldEvent[]): WorldEventEffects {
  const out = noEventEffects();
  for (const e of events) {
    const def = EVENT_BY_KIND.get(e.kind);
    if (!def) continue;
    out.forageDelta += def.effects.forageDelta;
    out.extraLoad += def.effects.extraLoad;
    out.regenMult *= def.effects.regenMult;
  }
  return out;
}

/** 演出家プロンプト用の一文（kind から引く）。未知なら名前のみ。 */
export function eventBlurb(kind: WorldEventKind): string {
  return EVENT_BY_KIND.get(kind)?.blurb ?? "";
}

/** 表示用ラベル（例「🍂大飢饉(2日目/4)」） */
export function eventLabel(e: WorldEvent): string {
  const dayNo = e.totalDays - e.remainingDays + 1;
  return `${e.icon}${e.name}(${dayNo}日目/${e.totalDays})`;
}
