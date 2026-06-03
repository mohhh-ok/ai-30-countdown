// 1ティックの決定論処理（plan.md 第9節 + 場所/移動）。
// LLM には行動・移動先・対人相手・日記・関係・パラメータ変動の「提案」だけを任せ、
// 数値の確定（負荷・収支・クランプ・死亡・段階・移動の妥当性）はこの層で行う。
// N 人（2人以上）に対応する。対人行動は targetId で相手を選び、同室の複数から誰に向けるかを決める。
import type {
  Action,
  Character,
  CharacterDecision,
  CharacterTickResult,
  DecisionProvider,
  DialogueLine,
  DialogueProvider,
  DialogueSpeaker,
  DirectorDecision,
  DirectorProvider,
  GuardianProvider,
  GuardianWhisper,
  Place,
  RewardEvent,
  SkillEffects,
  Talent,
  Tempo,
  Tension,
  TickResult,
  Weather,
  WorldState,
} from "./types.ts";
import { ACTION_LABELS } from "./types.ts";
import { distance, findPlace, isNeighbor, stepToward } from "./places.ts";
import { noSkillEffects } from "./skills.ts";
import { bumpSoul } from "./soul.ts";
import {
  CLIMAX_MENACE,
  DEADLINE_DAY,
  aggregateEventEffects,
  creepingLoad,
  decayEvents,
  disasterIntensity,
  makeCalamity,
  rollNewEvents,
} from "./events.ts";
import {
  AXIS_LABEL,
  DAILY_LOAD,
  FRENZY_BETRAYAL_GAIN,
  FRENZY_BURDEN_GAIN,
  FRENZY_DECAY,
  FRENZY_ISOLATION_GAIN,
  FRENZY_MAX,
  FRENZY_ONSET,
  FRENZY_TRUST_CEILING,
  LEAN_PROBABILITY,
  NEEDS_PARTNER,
  REWARD,
  STEAL_DRAIN_INCREASE,
  type RawRewardEvent,
  actionEffect,
  applyDeltas,
  applyRewards,
  clampParam,
  decayRewardState,
  sanitizeParamDeltas,
  stageOf,
} from "./rules.ts";

/** 天候を抽選する（plan.md 第2節）。直近2日連続で不作なら通常に寄せる。 */
function decideWeather(recentWeather: Weather[], rng: () => number): Weather {
  const lastTwoLean =
    recentWeather.length >= 2 &&
    recentWeather.slice(-2).every((w) => w === "lean");
  if (lastTwoLean) return "normal";
  return rng() < LEAN_PROBABILITY ? "lean" : "normal";
}

/**
 * 物語の緊張度を算出する（演出家の判断材料）。
 * - 誰かが餓死寸前 → tragic
 * - 全員バラバラで出会えない／直近の行動が単調に固定 → stagnant
 * - ストレス/葛藤が高い → tense
 * - それ以外 → calm
 */
function assessTension(state: WorldState, recentLog: TickResult[]): Tension {
  const living = state.characters.filter((c) => c.alive);
  if (living.some((c) => c.energy <= DANGER_ENERGY)) return "tragic";

  // 2人以上が全員別々の場所に留まり、誰とも出会えないまま日が過ぎている → 膠着
  if (living.length >= 2) {
    const placesNow = new Set(living.map((c) => c.currentPlaceId));
    const allApart = placesNow.size === living.length;
    if (allApart && recentLog.length >= 2) return "stagnant";
  }

  // 直近3日、全員の行動が固定なら膠着
  const last3 = recentLog.slice(-3);
  if (last3.length === 3) {
    const stagnant = living.every((c) => {
      const acts = last3.map(
        (t) => t.characters.find((r) => r.id === c.id)?.action,
      );
      return acts[0] && acts.every((a) => a === acts[0]);
    });
    if (stagnant) return "stagnant";
  }

  const highStress = living.some((c) => c.mood.stress >= 30);
  if (highStress) return "tense";
  return "calm";
}

/**
 * その日の「見せ場の大きさ」を点数化する（主役の自動選出・演出家未指定時のフォールバック）。
 * 死・段階変化・移動・衝動・対人・強い感情・大きなエネルギー変動ほど高い。
 */
function eventScore(r: CharacterTickResult): number {
  let s = r.mood.stress + Math.abs(r.energyDelta);
  if (r.moved) s += 6;
  if (r.stageChanged) s += 25;
  if (r.died) s += 100;
  if (r.impulse) s += 12;
  if (r.targetName) s += 8;
  return s;
}

/** ナギ（結の力）が休んだ地で癒し戻す清霊の量 */
const BOND_HEAL = 8;

/** 祓い清める（purify）で、その地の濁霊から祓える最大量（一部は清霊へ還る） */
const PURIFY_AMOUNT = 8;

/** 会話劇1シーンの長さ（往復ループの最小／最大発言数）。最低 MIN は続け、MAX で打ち切る。 */
const DIALOGUE_MIN_TURNS = 2;
const DIALOGUE_MAX_TURNS = 8;

/**
 * 餓死寸前とみなす霊力（カメラを寄せる＝シーンに昇格させる危険水準）。
 * plan.md「時間モデル」で合意した値。assessTension の tragic 判定と統一する。
 */
const DANGER_ENERGY = 12;

/** 集霊の結果（この地から頂いた/喰らった霊力） */
interface ForageDraw {
  gain: number; // 得た霊力（エネルギーに加算）
  sei: number; // 清霊から取った量
  daku: number; // 濁霊から取った量
  taboo: boolean; // 清き霊を喰らった（禁忌）か
}

/**
 * その地の民の霊力プールから集霊する（破壊的にプールを減らす）。異能で取り方が変わる。
 * - devour（奪命）: 濁を優先して多く喰らい、足りねば清も喰らう（禁忌）。地を激しく枯らす。
 * - insight（観の眼）: 効率よく頂く。枯れ地でもわずかに見つけ出す。
 * - それ以外: 清を穏当に頂く。
 */
function drawForagePool(
  place: Place,
  weather: Weather,
  boost: number,
  talent: Talent,
  frenzied = false,
): ForageDraw {
  const cap = Math.max(
    0,
    (weather === "normal" ? place.forage.normal : place.forage.lean) + boost,
  );
  if (cap <= 0) return { gain: 0, sei: 0, daku: 0, taboo: false };

  if (talent === "devour") {
    // 荒ぶり中はさらに激しく喰らう（荒びを貪り、足りねば和みにも深く踏み込んで地を激しく枯らす）
    const want = Math.round(cap * (frenzied ? 2.4 : 1.6));
    const dakuTake = Math.min(place.populace.daku, want);
    place.populace.daku -= dakuTake;
    const rest = want - dakuTake;
    const seiTake = Math.max(0, Math.min(place.populace.sei, rest)); // 足りねば清を喰らう
    place.populace.sei -= seiTake;
    return { gain: dakuTake + seiTake, sei: seiTake, daku: dakuTake, taboo: seiTake > 0 };
  }

  const mult = talent === "insight" ? 1.25 : 1.0;
  const want = Math.round(cap * mult);
  const seiTake = Math.min(place.populace.sei, want);
  place.populace.sei -= seiTake;
  let gain = seiTake;
  // 観の眼: 枯れ地でもわずかな霊脈を読み当てる（最低限の floor。新鮮な地ほどではない）
  if (talent === "insight" && want > 0 && gain < 2) gain = 2;
  return { gain, sei: seiTake, daku: 0, taboo: false };
}

/** 当日の変身・鎮静を観客向けの地の文（narration）に滲ませる。数値・intent は出さない（観客ビューの掟）。 */
function appendFrenzyNarration(base: string, results: CharacterTickResult[]): string {
  const lines: string[] = [];
  const becamer = results.find((r) => r.becameFrenzied);
  if (becamer) {
    lines.push(`——${becamer.name}の眼の色が変わる。餓えと猛りが理性を呑み、荒ぶりが鎌首をもたげた。`);
  }
  // 荒ぶり継続中に犯した所業（奪い・和みすら喰らう）も滲ませる（変身した当日は上で告げ済みなので除く）。
  const rampager = results.find(
    (r) =>
      r.frenzyActive &&
      !r.becameFrenzied &&
      !r.died &&
      (r.action === "steal" || r.forageDraw?.taboo),
  );
  if (rampager) {
    const deed =
      rampager.action === "steal"
        ? `${rampager.targetName ? `${rampager.targetName}から` : ""}霊を奪い`
        : "和みすら喰らい";
    lines.push(`荒ぶる${rampager.name}は${deed}、京の気をさらに枯らしていく。`);
  }
  if (results.some((r) => r.quelledFrenzy)) {
    const wild = results.find((r) => r.frenzyLevel !== undefined);
    const who = wild ? `荒ぶる${wild.name}` : "荒ぶる者";
    lines.push(`祓いの手が、${who}の猛りをゆっくりと鎮めていく。張りつめた気配が、ほどけていった。`);
  }
  if (lines.length === 0) return base;
  return base ? `${base}\n${lines.join("\n")}` : lines.join("\n");
}

/** 記憶バッファ（エピソード記憶）を直近 N 件に保つ */
const EPISODIC_LIMIT = 5;
function pushEpisodic(c: Character, entry: string): void {
  c.episodicMemory.push(entry);
  if (c.episodicMemory.length > EPISODIC_LIMIT) {
    c.episodicMemory = c.episodicMemory.slice(-EPISODIC_LIMIT);
  }
}

/**
 * 1ティックを進める。state を破壊的に更新し、TickResult を返す。
 */
export interface RunTickOptions {
  dialogueProvider?: DialogueProvider;
  directorProvider?: DirectorProvider;
  guardianProvider?: GuardianProvider;
  rng?: () => number;
  recentLog?: TickResult[];
  /** 主人公（スキル効果の適用先・カメラ固定先）の id。回帰ランナーが渡す。 */
  protagonistId?: string;
  /** 主人公が持ち越したスキルの実効効果（負荷/集霊/分与に効く）。 */
  skillEffects?: SkillEffects;
}

export async function runTick(
  state: WorldState,
  recentWeather: Weather[],
  provider: DecisionProvider,
  opts: RunTickOptions = {},
): Promise<TickResult> {
  const { dialogueProvider, directorProvider, guardianProvider, recentLog = [] } = opts;
  const rng = opts.rng ?? Math.random;
  // スキル効果は主人公（protagonistId）にのみ効く。未指定なら従来どおり効果なし。
  const protagonistId = opts.protagonistId;
  const skillEffects = opts.skillEffects ?? noSkillEffects();
  const isHero = (id: string): boolean => id === protagonistId;

  state.day += 1;

  // 0. 環境イベント（災い/恵み）の更新。天候・演出家より前に確定させ、演出家とも共有する。
  //    残日数を減らして尽きたものを除き、その日の新規をランダム抽選（複数同時多発し得る）。
  if (!state.activeEvents) state.activeEvents = []; // 旧スナップショット後方互換
  decayEvents(state);
  const newWorldEvents = rollNewEvents(state, rng);
  const eventEffects = aggregateEventEffects(state.activeEvents);

  // 0.05 災害は日を追うごとに強まる。猛威度（dayScale）を災いの負の効果に乗じ、30日へ近づくほど京を荒らす。
  const dayScale = disasterIntensity(state.day);
  if (eventEffects.forageDelta < 0) eventEffects.forageDelta = Math.round(eventEffects.forageDelta * dayScale);
  if (eventEffects.extraLoad > 0) eventEffects.extraLoad = Math.round(eventEffects.extraLoad * dayScale);
  if (eventEffects.regenMult < 1) eventEffects.regenMult = eventEffects.regenMult / dayScale;
  // 地脈の乱れ（決定論の逓増圧）。イベントの有無に関わらず日が進むほど全員の消耗が増す。
  const creepLoad = creepingLoad(state.day);

  // 0.06 30日目の大禍（確定災害）。ハルが持ち越した結界力で祓い退けられれば回避＝クリア。
  //   足りねば京は呑まれ、全員が打ち倒される（→ ハル死で回帰）。
  let climax: { menace: number; wardPower: number; averted: boolean } | undefined;
  let climaxBlow = 0;
  if (state.day === DEADLINE_DAY) {
    const wardPower = skillEffects.wardPower;
    const averted = wardPower >= CLIMAX_MENACE;
    climax = { menace: CLIMAX_MENACE, wardPower, averted };
    const calamity = makeCalamity();
    state.activeEvents.push(calamity); // 表示（worldEvents）に乗せる。世界は周末で作り直されるので残らない。
    newWorldEvents.push(calamity); // 幕開けで必ず告げる
    if (!averted) climaxBlow = 9999; // 結界が及ばねば京は呑まれる
  }

  // 0.1 演出家の介入（環境＋守護神への指示）。緊張度を読む。
  const tension = assessTension(state, recentLog);
  let director: DirectorDecision | undefined;
  if (directorProvider) {
    try {
      director = await directorProvider(state, tension, recentLog);
    } catch (err) {
      console.error("[director] failed:", err instanceof Error ? err.message : err);
    }
  }
  const weather = director?.weather ?? decideWeather(recentWeather, rng);
  state.weather = weather;

  // 0.5 守護神の囁き。演出家の指示を各キャラの「内なる声」に変え、行動決定に注入する。
  let whispers: GuardianWhisper[] = [];
  if (guardianProvider && director && director.directives.length > 0) {
    try {
      whispers = await guardianProvider(state, director.directives);
    } catch (err) {
      console.error("[guardian] failed:", err instanceof Error ? err.message : err);
    }
  }
  // 一時フィールドに乗せる（行動決定プロンプトが読む）
  for (const c of state.characters) c.currentWhisper = undefined;
  for (const w of whispers) {
    const c = state.characters.find((x) => x.id === w.id);
    if (c) c.currentWhisper = w.whisper;
  }

  // 場所ごとの実り一時増減（演出家の介入＋環境イベント）。
  //  イベントの forageDelta は京全体（全場所）へ一律にかかり、演出家の局所操作と重なる。
  const forageBoost = new Map<string, number>();
  for (const p of state.places) {
    if (eventEffects.forageDelta !== 0) forageBoost.set(p.id, eventEffects.forageDelta);
  }
  for (const b of director?.forageBoosts ?? []) {
    forageBoost.set(b.placeId, (forageBoost.get(b.placeId) ?? 0) + b.delta);
  }

  // 民の霊力は日ごとにゆっくり回復する（枯れた地も時を経て息を吹き返す）。
  //  飢饉/冷害では回復が鈍り（regenMult<1）、豊穣では増す（>1）。持続するほど京がじわり枯れる。
  for (const p of state.places) {
    p.populace.sei = Math.min(
      p.populaceMax.sei,
      p.populace.sei + Math.round(p.regen.sei * eventEffects.regenMult),
    );
    p.populace.daku = Math.min(
      p.populaceMax.daku,
      p.populace.daku + Math.round(p.regen.daku * eventEffects.regenMult),
    );
  }

  // 祓いで実際に清めた濁霊の量（報酬・演出で使う）。step4 で記録。
  const purifyCleansedById = new Map<string, number>();
  // 集霊の結果（取れ高の内訳）。step4 で1度だけ引き、報酬・表示で使い回す。
  const forageDrawById = new Map<string, ForageDraw>();
  const doForage = (actor: Character, place: Place): number => {
    const boost = forageBoost.get(place.id) ?? 0;
    const r = drawForagePool(place, weather, boost, actor.talent, actor.frenzy?.active ?? false);
    // 主人公のスキル「観の眼・冴え」など、集霊倍率を取れ高に乗せる
    if (isHero(actor.id) && skillEffects.forageMult !== 1) {
      r.gain = Math.round(r.gain * skillEffects.forageMult);
    }
    forageDrawById.set(actor.id, r);
    return r.gain;
  };

  const living = state.characters.filter((c) => c.alive);
  const placeName = (id: string): string =>
    findPlace(state.places, id)?.name ?? id;

  // 1. 負荷（−6）を生者全員に適用
  const energyBefore = new Map<string, number>();
  for (const c of living) {
    energyBefore.set(c.id, c.energy);
    // 主人公のスキル「飢えを越えた者」などで日次負荷が軽くなる（最低1は残す）
    const baseLoad = isHero(c.id)
      ? Math.max(1, DAILY_LOAD - skillEffects.loadReduction)
      : DAILY_LOAD;
    // 疫病など環境イベントの追加消耗・地脈の乱れ・大禍は災いなので主人公にも等しくのしかかる。
    // stealBurden: 禁忌「奪う」を犯すたび積もった、本人だけの恒久的な日次負荷の上乗せ（奪うほど重い）。
    //   ※ loadReduction（飢えを和らげるスキル）は baseLoad にのみ効かせ、stealBurden には意図的に効かせない。
    //     これは「業＝禁忌の代償」であり、飢え対策スキルで帳消しにできない別軸のペナルティとして残す。
    c.energy -= baseLoad + eventEffects.extraLoad + creepLoad + climaxBlow + c.stealBurden;
  }

  // 2. LLM に行動・移動先・対人相手・日記・関係・パラメータ変動を決めさせる（囁きはプロンプトに乗る）
  const decision = await provider(state, weather);
  const decisionById = new Map<string, CharacterDecision>();
  for (const d of decision.characters) decisionById.set(d.id, d);
  // 囁きは当日の決定限り。役目を終えたら消す。
  for (const c of state.characters) c.currentWhisper = undefined;

  // 2.5 衝動。囁きを受けても動かない日が募ると、抑えきれず最も近い相手の方へ動き出す。
  //  全員が同時に動くとすれ違う（鬼ごっこ）ので、衝動は1人だけに発火させ、相手は留まる。
  const IMPULSE_THRESHOLD = 2;
  const whisperedIds = new Set(whispers.map((w) => w.id));
  const impulseIds = new Set<string>();
  const impulseCandidates: Character[] = [];
  for (const actor of living) {
    const d = decisionById.get(actor.id);
    if (!d) continue;
    // 「誰か」が別の場所にいる（出会えていない）状態か
    const hasFarOther = living.some(
      (c) => c.id !== actor.id && c.currentPlaceId !== actor.currentPlaceId,
    );
    if (whisperedIds.has(actor.id) && hasFarOther) {
      // move も follow も「自分から相手の方へ動いた」＝囁きに応えた一手として扱う
      if (d.action === "move" || d.action === "follow") {
        actor.whisperIgnored = 0; // 囁きに従って自分から動いた
      } else {
        actor.whisperIgnored = (actor.whisperIgnored ?? 0) + 1;
        if (actor.whisperIgnored >= IMPULSE_THRESHOLD) impulseCandidates.push(actor);
      }
    } else {
      actor.whisperIgnored = 0;
    }
  }
  if (impulseCandidates.length > 0) {
    // 最も孤独に弱い者が動く（同点なら耐えた日数が長い方）。相手は留まり、出会いが成立する。
    impulseCandidates.sort(
      (a, b) =>
        b.lonelinessSensitivity - a.lonelinessSensitivity ||
        (b.whisperIgnored ?? 0) - (a.whisperIgnored ?? 0),
    );
    const mover = impulseCandidates[0];
    // 最も近い相手（別の場所にいる生存者）に向かう
    const others = living
      .filter((c) => c.id !== mover.id && c.currentPlaceId !== mover.currentPlaceId)
      .sort(
        (a, b) =>
          distance(state.places, mover.currentPlaceId, a.currentPlaceId) -
          distance(state.places, mover.currentPlaceId, b.currentPlaceId),
      );
    const nearest = others[0];
    const target = nearest
      ? stepToward(state.places, mover.currentPlaceId, nearest.currentPlaceId)
      : undefined;
    const d = decisionById.get(mover.id);
    if (target && d) {
      d.action = "move";
      d.moveTarget = target;
      d.diary = `（抑えきれない衝動に突き動かされて）${d.diary ?? ""}`.trim();
      mover.whisperIgnored = 0;
      impulseIds.add(mover.id);
    }
  }

  // 2.6 利他の贈与（ココロの起点づくり）。利他が成熟した者が、同室に弱った相手（特にハル）を
  //  見ているのに rest/forage で済ませようとしているなら、その一手を「分け与え」へ向ける。
  //  これが無いと誰も最初の贈与をせず、受け手にココロ（利他の心）が芽生える種が生まれない
  //  （実測: 全周で share がほぼ 0。満腹基準のガードが、慢性的に飢えるナギの分与を永遠に阻んでいた）。
  //  衝動と同じく決定論の一手であり、上書きしたぶんは日記にも理由を滲ませて可視化する（握りつぶさない）。
  const GIFT_ALTRUISM = 60; // 利他が「成熟」域（弱者を見過ごせなくなる閾値）
  // 分け与え後もこの霊力を保てるなら分ける「死なない最低線(survival floor)」。
  //  かつては「満腹(satiety)+余裕」基準だったが、ナギは利他が成熟する瞬間ほぼ常に自分も飢えており
  //  (energy < satiety)、満腹基準では分与が永遠に発火しなかった（実測: 全周 share 0%。利他100のナギすら
  //  弱者の隣で満腹を超えていたのは 17手中1手）。満腹でなく「死なない最低線」を基準にして share を起こす。
  //  深く分けて枯れる与え手（主にナギ）は、ハルの会得スキル「涸らさぬ手」(返霊+10) が受け止めて救う。
  const GIFT_FLOOR = 5;
  for (const actor of living) {
    const d = decisionById.get(actor.id);
    if (!d) continue;
    if (impulseIds.has(actor.id)) continue; // 衝動で動く者はそちらを優先
    if (actor.params.altruism < GIFT_ALTRUISM) continue;
    if (d.action !== "rest" && d.action !== "forage") continue; // 切迫した／意味のある一手は奪わない
    // 分け与えても「死なない最低線」を割らないこと（満腹基準でなく survival floor）。
    //  share の自己消費は推測でハードコードせず actionEffect から取る。
    const shareCost = -actionEffect("share", weather, findPlace(state.places, actor.currentPlaceId)!).self;
    if (actor.energy - shareCost < GIFT_FLOOR) continue;
    // 同室の弱った生存者（自分以外）。ハルを最優先、次いで最も弱い者へ。
    const weak = living
      .filter(
        (c) =>
          c.id !== actor.id &&
          c.currentPlaceId === actor.currentPlaceId &&
          c.energy < c.satiety,
      )
      .sort((a, b) => {
        const ah = a.id === protagonistId ? 0 : 1;
        const bh = b.id === protagonistId ? 0 : 1;
        return ah - bh || a.energy - b.energy;
      })[0];
    if (!weak) continue;
    d.action = "share";
    d.targetId = weak.id;
    d.diary = `（弱っている${weak.name}を見かね、霊力を分け与えることにした）${d.diary ?? ""}`.trim();
  }

  // パラメータ更新前の値（段階変化の検出用）
  const paramsBefore = new Map(
    living.map((c) => [c.id, { ...c.params }] as const),
  );
  // 行動前の現在地（移動の記録用・対人相手の判定用）
  const placeBefore = new Map(living.map((c) => [c.id, c.currentPlaceId] as const));

  // 3. 行動の妥当性を解決（移動・同じ場所制約）。現在地が確定してから効果を適用する。
  //    移動は同じ日に「行動前の位置関係」で相手判定したいので、まず行動を確定し、
  //    効果（特に対人）は行動前の同室相手に対して与える。
  const resolved = new Map<
    string,
    { action: Action; moved: boolean; fromPlaceId?: string }
  >();
  // follow（寄り添う）が向かう相手。離れていれば追って動く・同室なら傍にいる。表示・報酬で使う。
  const followTargetById = new Map<string, Character | undefined>();

  // follow の相手を全生存者から選ぶ（同室前提でないのが share/talk との違い）。
  //  decision.targetId が他の生存者を指していればそれ、無ければ最も近い相手。
  //  距離は「行動前の位置（placeBefore）」で測る。同ループ内で先に動いた follow 者の
  //  移動後位置を拾って判定がぶれるのを防ぐ（3人以上で相手選びがズレないように）。
  function resolveFollowTarget(actor: Character): Character | undefined {
    const myFrom = placeBefore.get(actor.id)!;
    const others = living.filter((c) => c.id !== actor.id);
    if (others.length === 0) return undefined;
    const d = decisionById.get(actor.id);
    if (d?.targetId) {
      const t = others.find((o) => o.id === d.targetId);
      if (t) return t;
    }
    return [...others].sort(
      (a, b) =>
        distance(state.places, myFrom, placeBefore.get(a.id)!) -
        distance(state.places, myFrom, placeBefore.get(b.id)!),
    )[0];
  }

  for (const actor of living) {
    const d = decisionById.get(actor.id);
    let action: Action = d?.action ?? "rest";
    let moved = false;
    let fromPlaceId: string | undefined;

    if (action === "move") {
      const target = d?.moveTarget;
      if (
        target &&
        target !== actor.currentPlaceId &&
        isNeighbor(state.places, actor.currentPlaceId, target)
      ) {
        fromPlaceId = actor.currentPlaceId;
        actor.currentPlaceId = target;
        moved = true;
      } else {
        // 行けない/移動先未指定 → 休む扱い
        action = "rest";
      }
    } else if (action === "follow") {
      // 寄り添う: 相手のいる地へ。離れていれば1歩近づき（その日は集霊不可）、同室なら傍にいる。
      //  位置関係は placeBefore（行動前）で測り、同ループ内の他者の移動に影響されないようにする。
      const tgt = resolveFollowTarget(actor);
      followTargetById.set(actor.id, tgt);
      const myFrom = placeBefore.get(actor.id)!;
      if (!tgt) {
        action = "rest"; // 独りなら寄り添えない
      } else if (placeBefore.get(tgt.id) !== myFrom) {
        const step = stepToward(state.places, myFrom, placeBefore.get(tgt.id)!);
        if (step && step !== myFrom) {
          fromPlaceId = myFrom;
          actor.currentPlaceId = step;
          moved = true;
        }
        // 一歩も寄れない（経路なし）→ その場で寄り添う気持ちのまま留まる
      }
    }
    if (d) d.action = action;
    resolved.set(actor.id, { action, moved, fromPlaceId });
  }

  // 行動前に同じ場所にいた生存者たち（対人行動の相手候補）
  function coLocatedBefore(actor: Character): Character[] {
    const from = placeBefore.get(actor.id);
    return living.filter(
      (c) => c.id !== actor.id && placeBefore.get(c.id) === from,
    );
  }
  // 対人行動の相手を決める。decision.targetId が同室の生存者を指していればそれ、無ければ先頭。
  function resolveTarget(actor: Character): Character | undefined {
    const peers = coLocatedBefore(actor);
    if (peers.length === 0) return undefined;
    const d = decisionById.get(actor.id);
    if (d?.targetId) {
      const t = peers.find((p) => p.id === d.targetId);
      if (t) return t;
    }
    return peers[0];
  }
  const targetById = new Map<string, Character | undefined>();
  for (const actor of living) targetById.set(actor.id, resolveTarget(actor));

  /** その日 actor を対人行動の相手に選んだ「他者」を列挙（分け与え・奪うの受け手判定用） */
  function actorsTargeting(actor: Character): Character[] {
    return living.filter(
      (o) => o.id !== actor.id && targetById.get(o.id)?.id === actor.id,
    );
  }

  const reaches = (a?: Action) => a === "talk" || a === "share";

  // 4. 行動効果を確定（エネルギー収支）
  for (const actor of living) {
    const r = resolved.get(actor.id)!;
    let action = r.action;
    const target = targetById.get(actor.id);
    // 相手が必要な行動なのに同室の相手がいなければ休む
    if (NEEDS_PARTNER[action] && !target) {
      action = "rest";
      r.action = action;
      const d = decisionById.get(actor.id);
      if (d) d.action = action;
    }
    const place = findPlace(state.places, placeBefore.get(actor.id)!)!;
    const eff = actionEffect(action, weather, place);
    // 主人公のスキル「分かち合いの味」で、分け与えるときの自己消費が軽くなる（self は負値なので加算で軽減）
    let self = eff.self;
    if (action === "share" && isHero(actor.id)) {
      self = Math.min(0, self + skillEffects.shareSelfReduction);
    }
    // forage（集霊）は民の霊力プールから引く。それ以外は固定効果。
    actor.energy += action === "forage" ? doForage(actor, place) : self;
    // 相手への害/恵み（partner 増減）を相手に適用する。
    if (target && eff.partner !== 0) {
      let partner = eff.partner;
      // 主人公のスキル「奪われぬ芯」: 奪われるときの霊力喪失を軽くする（partner は負値）
      if (action === "steal" && isHero(target.id) && skillEffects.stealResist > 0) {
        partner = Math.round(partner * (1 - skillEffects.stealResist));
      }
      target.energy += partner;
      // 主人公のスキル「涸らさぬ手」: ハルが分与を受けたとき、削って分けてくれた相手（share元＝主にナギ）に
      // 霊力を返し、与え手の身を涸らさない。share の自己消費(-10)をほぼ相殺する「完全救済」。
      if (action === "share" && isHero(target.id) && skillEffects.shareReflect > 0) {
        actor.energy += skillEffects.shareReflect;
      }
    }
    // 禁忌「奪う」を犯すと、奪った側自身の日次負荷が恒久的に増す（旨味 energy +12 の代償）。
    // 以後ずっと毎ティックの消耗が重くなり、回帰内では戻らない。奪い続ければ自滅へ向かう。
    if (action === "steal") {
      actor.stealBurden += STEAL_DRAIN_INCREASE;
    }
    // ナギ（結の力）が気を鎮める（休む）と、その地の清霊を癒し戻す
    if (actor.talent === "bond" && action === "rest") {
      place.populace.sei = Math.min(place.populaceMax.sei, place.populace.sei + BOND_HEAL);
    }
    // 祓い: その地の濁霊を清霊へ還す（荒れた地を癒す利他行為）。devour で穢れた京の回復弁。
    if (action === "purify") {
      const cleansed = Math.min(place.populace.daku, PURIFY_AMOUNT);
      place.populace.daku -= cleansed;
      place.populace.sei = Math.min(
        place.populaceMax.sei,
        place.populace.sei + Math.round(cleansed * 0.6),
      );
      purifyCleansedById.set(actor.id, cleansed);
    }
  }

  // 4.5 鎮め（ハルが荒ぶる半妖を祓い鎮める）。会得した鎮めの術 quellPower が荒ぶり度に届けば鎮静。
  //  鎮め損ねても「荒ぶる者と同じ地で向き合って祓った」事実は heroFacedFrenzy に残し、career スキル
  //  「鎮めの術」を育てる糧にする（#1 measure＝救えなかった子を次周で救うという回帰の核）。
  let heroFacedFrenzy = false;
  let heroQuelledFrenzy = false;
  {
    const hero = living.find((c) => isHero(c.id));
    if (hero && resolved.get(hero.id)?.action === "purify") {
      const wild = living.find(
        (c) => c.frenzy?.active && c.currentPlaceId === hero.currentPlaceId,
      );
      if (wild?.frenzy) {
        heroFacedFrenzy = true;
        if (skillEffects.quellPower >= wild.frenzy.level) {
          // 鎮静: 変身を解き、荒ぶり中に溜めた後払いの業を本人へ清算する（C: カイ自身が消耗へ向かう）。
          wild.stealBurden += wild.frenzy.pendingBurden;
          wild.frenzy.pendingBurden = 0;
          wild.frenzy.level = 0;
          wild.frenzy.active = false;
          heroQuelledFrenzy = true;
        }
      }
    }
  }

  // 5. パラメータ変動を適用（±5・最大2項目に安全化）
  for (const actor of living) {
    const d = decisionById.get(actor.id);
    if (!d) continue;
    const safeDeltas = sanitizeParamDeltas(d.paramDeltas);
    d.paramDeltas = safeDeltas;
    actor.params = applyDeltas(actor.params, safeDeltas);

    // 利他フィードバック（決定論・LLM 裁量とは別の底上げ）。
    //  利他の芯にかなう行い「分け与える／祓い清める／寄り添う」を実際に
    //  成立させた日は、利他をわずかに底上げする。これが無いと利他が LLM 裁量だけでは
    //  伸び切らず、利他に依る会得スキル（独りを断つ=70 等）やキャラ解放（利他85）が
    //  実プレイで永遠に届かない（到達可能性アウディットの 🔴 対策）。
    const myAction = resolved.get(actor.id)?.action;
    let altruismBonus = 0;
    if (myAction === "share" && targetById.get(actor.id)) altruismBonus = 4; // 分与の成立
    else if (myAction === "purify" && (purifyCleansedById.get(actor.id) ?? 0) > 0)
      altruismBonus = 4; // 荒れ地を実際に清めた
    else if (myAction === "follow" && followTargetById.get(actor.id)) altruismBonus = 2; // 寄り添いに動いた（離れた相手も含む）
    if (altruismBonus > 0) {
      actor.params.altruism = clampParam(actor.params.altruism + altruismBonus);
      // 楽屋ビュー（TickLog）の表示が実変動とズレないよう、ボーナス分も paramDeltas に反映する。
      // ※sanitize（±5・最大2項目）は通過済み。これは表示用の事後加算。
      d.paramDeltas = {
        ...d.paramDeltas,
        altruism: (d.paramDeltas.altruism ?? 0) + altruismBonus,
      };
    }

    if (d.relationLabel) actor.relationLabel = d.relationLabel;
    if (d.diary) actor.diary.push(d.diary);
  }

  // 5.5 関係フィードバック（決定論・控えめ）。
  //  「実際に交流が成立した／応えてもらえなかった」という経験の結果として信頼を動かす。
  //  - 語りかけ/分け与えが互いに向き合って噛み合った → その人の信頼 +1
  //  - 一方的に働きかけたのに相手が応じなかった → 働きかけた側の信頼 −1
  const interaction = new Map<string, "mutual" | "ignored" | "neutral">();
  for (const actor of living) {
    const myAct = resolved.get(actor.id)?.action;
    const target = targetById.get(actor.id);
    if (reaches(myAct) && target) {
      const targetAct = resolved.get(target.id)?.action;
      const targetBackAtMe = targetById.get(target.id)?.id === actor.id;
      if (reaches(targetAct) && targetBackAtMe) {
        actor.params.trust = clampParam(actor.params.trust + 1);
        interaction.set(actor.id, "mutual");
      } else {
        actor.params.trust = clampParam(actor.params.trust - 1);
        interaction.set(actor.id, "ignored");
      }
    } else {
      interaction.set(actor.id, "neutral");
    }
  }

  // 5.6 報酬・抗体の更新。
  //  行動の結果＝イベントに報酬を出し、抗体で実効報酬を鈍らせ、気分を更新する。
  //  まず昨日からの減衰（立ち直り・耐性の回復）→ 今日のイベントを適用、の順。
  for (const actor of living) decayRewardState(actor);
  const rewardEventsById = new Map<string, RewardEvent[]>();
  // この日あらたに変身した（平常→荒ぶり）者の id。演出（#5）の見せ場に使う。
  const becameFrenziedById = new Map<string, boolean>();
  // この日、誰かに霊力を奪われた（steal の標的にされた）者の id。耐性スキル「奪われぬ芯」の会得判定に使う。
  const stolenFromById = new Map<string, boolean>();
  for (const actor of living) {
    const act = resolved.get(actor.id)!.action;
    const target = targetById.get(actor.id);
    const targetAct = target ? resolved.get(target.id)?.action : undefined;
    const targetBackAtMe = target ? targetById.get(target.id)?.id === actor.id : false;
    const place = findPlace(state.places, placeBefore.get(actor.id)!)!;
    const raw: RawRewardEvent[] = [];

    // 自分の行動から生じる報酬/ストレス
    if (act === "forage") {
      const dr = forageDrawById.get(actor.id) ?? { gain: 0, sei: 0, daku: 0, taboo: false };
      if (actor.talent === "devour") {
        if (dr.daku > 0) {
          raw.push({ channel: "thrill", label: `${place.name}で荒びを${dr.daku}喰らった`, base: dr.daku });
        }
        if (dr.sei > 0) {
          raw.push({ channel: "thrill", label: `${place.name}で和みさえ${dr.sei}喰らった（禁忌）`, base: dr.sei });
          raw.push({ channel: "stress", label: "和みさえ喰らった業がのしかかる", base: -Math.round(dr.sei * 0.6) });
        }
        if (dr.gain === 0) {
          raw.push({ channel: "stress", label: `${place.name}には喰らう霊も残っていない`, base: -3 });
        }
      } else {
        const label =
          dr.gain > 0
            ? `${place.name}で和みを${dr.gain}頂いた`
            : `${place.name}は枯れ、頂ける霊がなかった`;
        raw.push({ channel: dr.gain > 0 ? "achievement" : "stress", label, base: dr.gain > 0 ? dr.gain : -3 });
      }
    } else if (act === "rest") {
      raw.push({ channel: "comfort", label: "休んで安らいだ", base: REWARD.rest });
    } else if (act === "talk") {
      if (reaches(targetAct) && targetBackAtMe && target) {
        raw.push({ channel: "bond", label: `${target.name}と心が通った`, base: REWARD.talkMutual });
      } else {
        raw.push({
          channel: "stress",
          label: target ? `${target.name}に語りかけたが応じてもらえなかった` : "語りかけたが独りだった",
          base: REWARD.ignored,
        });
      }
    } else if (act === "share" && target) {
      raw.push({ channel: "bond", label: `${target.name}に分け与えた`, base: REWARD.shareGiven });
    } else if (act === "steal") {
      raw.push({ channel: "thrill", label: target ? `${target.name}から奪った` : "奪った", base: REWARD.illicit });
    } else if (act === "follow") {
      const ft = followTargetById.get(actor.id);
      const beside = ft && ft.currentPlaceId === actor.currentPlaceId;
      raw.push({
        channel: "bond",
        label: ft
          ? beside
            ? `${ft.name}の傍に寄り添った`
            : `${ft.name}を追って歩いた`
          : "寄り添う相手を求めた",
        base: REWARD.follow,
      });
    } else if (act === "purify") {
      const cleansed = purifyCleansedById.get(actor.id) ?? 0;
      raw.push(
        cleansed > 0
          ? { channel: "comfort", label: `${place.name}の荒びを${cleansed}鎮めた`, base: REWARD.purify }
          : { channel: "comfort", label: `${place.name}で静かに祈った`, base: REWARD.purifyQuiet },
      );
    }

    // 他者の行動から受ける報酬/被害（自分を相手に選んだ者すべてから）
    for (const o of actorsTargeting(actor)) {
      const oAct = resolved.get(o.id)?.action;
      if (oAct === "share") {
        raw.push({ channel: "bond", label: `${o.name}から分けてもらった`, base: REWARD.shareReceived });
        bumpSoul(actor, "altruism"); // 利他の心: 分けてもらった経験を刻む（積もると芽生え、プロンプトへ注入される）
      } else if (oAct === "steal") {
        stolenFromById.set(actor.id, true); // 標的にされた事実を記録（耐性スキルの会得判定用）
        let base: number = REWARD.victim;
        // 主人公のスキル「奪われぬ芯」: 奪われたときのストレスを軽くする（base は負値）
        if (isHero(actor.id) && skillEffects.stealResist > 0) {
          base = Math.round(base * (1 - skillEffects.stealResist));
        }
        raw.push({ channel: "stress", label: `${o.name}に奪われた`, base });
      }
    }

    // 孤独（日の終わりに同じ場所に誰もいない日はこたえる。感受性は個体差）
    const coLocatedNow = living.filter(
      (c) => c.id !== actor.id && c.currentPlaceId === actor.currentPlaceId,
    );
    if (living.length >= 2 && coLocatedNow.length === 0 && actor.lonelinessSensitivity > 0) {
      // 最も近い相手の名を添える（演出のため）
      const nearest = living
        .filter((c) => c.id !== actor.id)
        .sort(
          (a, b) =>
            distance(state.places, actor.currentPlaceId, a.currentPlaceId) -
            distance(state.places, actor.currentPlaceId, b.currentPlaceId),
        )[0];
      raw.push({
        channel: "stress",
        label: nearest ? `${nearest.name}たちと離れていて心細い` : "ひとりで心細い",
        base: -actor.lonelinessSensitivity,
      });
    }

    // 充足／飢え（その日の終わりのエネルギーに対して）
    if (actor.energy >= actor.satiety) {
      raw.push({ channel: "comfort", label: "満ち足りている", base: REWARD.satiety });
    } else {
      const deficit = actor.satiety - Math.max(0, actor.energy);
      if (deficit > 0) {
        raw.push({ channel: "stress", label: "飢えが身にこたえる", base: -Math.round(deficit * REWARD.hungerScale) });
      }
    }

    rewardEventsById.set(actor.id, applyRewards(actor, raw));

    // 5.7 荒ぶり（変身）の蓄積・判定（frenzy を持つ＝半妖カイのみ）。
    //  孤立（同室者なし）・裏切り（一方的に拒まれた／奪われた）が、信頼の地に落ちた者に募る。
    //  level が FRENZY_ONSET に達すると変身（active）。以後は鎮め(#4 quellPower)でしか解けない＝自然鎮静なし。
    //  変身前で信頼が満ち、満たされた日には level がわずかに引き、変身に至らず鎮まることもある。
    const frenzy = actor.frenzy;
    if (frenzy) {
      // 変身中に犯した業（奪う／激しく喰らう）を後払いで溜める。鎮静時(#4)にまとめて本人へ清算する。
      if (frenzy.active) {
        const act = resolved.get(actor.id)?.action;
        const drew = (forageDrawById.get(actor.id)?.gain ?? 0) > 0;
        if (act === "steal" || (act === "forage" && drew)) {
          frenzy.pendingBurden += FRENZY_BURDEN_GAIN;
        }
      }
      const isolated = living.length >= 2 && coLocatedNow.length === 0;
      const betrayed =
        interaction.get(actor.id) === "ignored" || (stolenFromById.get(actor.id) ?? false);
      let gain = 0;
      if (actor.params.trust < FRENZY_TRUST_CEILING) {
        if (isolated) gain += FRENZY_ISOLATION_GAIN;
        if (betrayed) gain += FRENZY_BETRAYAL_GAIN;
      }
      if (gain > 0) {
        frenzy.level = Math.min(FRENZY_MAX, frenzy.level + gain);
      } else if (!frenzy.active && actor.params.trust >= FRENZY_TRUST_CEILING) {
        frenzy.level = Math.max(0, frenzy.level - FRENZY_DECAY);
      }
      if (!frenzy.active && frenzy.level >= FRENZY_ONSET) {
        frenzy.active = true;
        becameFrenziedById.set(actor.id, true); // この日あらたに変身（演出の見せ場）
      }
    }
  }

  // 6. 結果の組み立て + 死亡判定 + 段階変化 + 記憶更新
  const results: CharacterTickResult[] = [];
  for (const actor of living) {
    const d = decisionById.get(actor.id);
    const r = resolved.get(actor.id)!;
    const before = energyBefore.get(actor.id) ?? actor.energy;
    const pBefore = paramsBefore.get(actor.id) ?? actor.params;
    const action: Action = r.action;
    const target = targetById.get(actor.id);
    // 表示・記憶用の相手。follow は離れた相手も追うため followTargetById から取る。
    const personalTarget = action === "follow" ? followTargetById.get(actor.id) : target;

    // 大禍を祓い退けた日（averted）は、結界を成したハルはその日倒れない（通常負荷で力尽きてクリアを取りこぼさない）。
    if (climax?.averted && isHero(actor.id) && actor.energy <= 0) actor.energy = 1;
    const died = actor.energy <= 0;
    if (died) actor.alive = false;

    const stageBefore = stageOf(pBefore[actor.growthAxis]);
    const stageAfter = stageOf(actor.params[actor.growthAxis]);
    const stageChanged = stageBefore !== stageAfter;

    // 日の終わりに誰か（生存者）と同じ場所にいるか
    const withPartner = living.some(
      (c) => c.id !== actor.id && c.alive && c.currentPlaceId === actor.currentPlaceId,
    );

    // 記憶（エピソード）の更新 — 相手の反応を含めた文脈付きの記憶にする
    const placeLabel = placeName(actor.currentPlaceId);
    const pName = target?.name;
    const pAct = target ? resolved.get(target.id)?.action : undefined;
    const pBack = target ? targetById.get(target.id)?.id === actor.id : false;
    let memo: string;
    if (r.moved) {
      const followName = action === "follow" ? followTargetById.get(actor.id)?.name : undefined;
      memo = followName
        ? `Day${state.day}: ${followName}を追って${placeName(r.fromPlaceId!)}から${placeLabel}へ`
        : `Day${state.day}: ${placeName(r.fromPlaceId!)}から${placeLabel}へ移動`;
    } else {
      const base = `Day${state.day}: ${placeLabel}で`;
      if (action === "talk") {
        memo =
          base +
          (reaches(pAct) && pBack && pName
            ? `${pName}と言葉を交わした`
            : pName
              ? `${pName}に話しかけたが応じてもらえなかった`
              : `独り言ちた`);
      } else if (action === "share") {
        memo = base + (pName ? `${pName}に分け与えた` : `分け与えようとした`);
      } else if (action === "forage") {
        memo = base + `採取した`;
      } else if (action === "steal" && pName) {
        memo = base + `${pName}から奪った`;
      } else if (action === "follow") {
        const ft = followTargetById.get(actor.id)?.name;
        memo = base + (ft ? `${ft}の傍に寄り添った` : `寄り添う相手を探した`);
      } else if (action === "purify") {
        const cleansed = purifyCleansedById.get(actor.id) ?? 0;
        memo = base + (cleansed > 0 ? `荒びを鎮めた` : `静かに祈った`);
      } else {
        memo = base + ACTION_LABELS[action];
      }
      if (died) memo += "（力尽きた）";
    }
    pushEpisodic(actor, memo);

    const isPersonal =
      action === "talk" ||
      action === "share" ||
      action === "steal" ||
      action === "follow";

    results.push({
      id: actor.id,
      name: actor.name,
      action,
      actionLabel: ACTION_LABELS[action],
      energyBefore: before,
      energyAfter: actor.energy,
      energyDelta: actor.energy - before,
      paramsBefore: pBefore,
      paramsAfter: { ...actor.params },
      paramDeltas: d?.paramDeltas ?? {},
      deltaReason: d?.deltaReason ?? "",
      diary: d?.diary ?? "",
      relationLabel: actor.relationLabel,
      stageBefore,
      stageAfter,
      stageChanged,
      died,
      placeId: actor.currentPlaceId,
      placeName: placeLabel,
      moved: r.moved,
      fromPlaceId: r.moved ? r.fromPlaceId : undefined,
      fromPlaceName: r.moved ? placeName(r.fromPlaceId!) : undefined,
      withPartner,
      targetId: isPersonal ? personalTarget?.id : undefined,
      targetName: isPersonal ? personalTarget?.name : undefined,
      forageDraw: action === "forage" ? forageDrawById.get(actor.id) : undefined,
      purifyCleansed: action === "purify" ? (purifyCleansedById.get(actor.id) ?? 0) : undefined,
      stealBurden: actor.stealBurden,
      wasStolenFrom: stolenFromById.get(actor.id) ?? false,
      impulse: impulseIds.has(actor.id),
      rewardEvents: rewardEventsById.get(actor.id) ?? [],
      mood: { ...actor.mood },
      antibodies: { ...actor.antibodies },
      // 荒ぶり（変身）。frenzy を持つ＝カイのみ値が入る。
      frenzyLevel: actor.frenzy?.level,
      frenzyPendingBurden: actor.frenzy?.pendingBurden,
      frenzyActive: actor.frenzy?.active,
      becameFrenzied: becameFrenziedById.get(actor.id) ?? false,
      facedFrenzy: isHero(actor.id) ? heroFacedFrenzy : false,
      quelledFrenzy: isHero(actor.id) ? heroQuelledFrenzy : false,
    });
  }

  // 7. 終了判定（生者1人以下）
  if (state.characters.filter((c) => c.alive).length <= 1) {
    state.finished = true;
  }

  // 注目の変化（plan.md 第10節）
  const notableParts: string[] = [];
  for (const e of newWorldEvents) {
    if (e.kind === "calamity") continue; // 大禍は下で専用の一文を立てる
    notableParts.push(
      e.kind === "bounty"
        ? `${e.name}が京を潤しはじめた（${e.totalDays}日続く）。`
        : `${e.name}が京を襲った（${e.totalDays}日続く）。`,
    );
  }
  if (climax) {
    notableParts.unshift(
      climax.averted
        ? `——大禍、来たる。ハルの結界が京を護り抜いた（結界力${climax.wardPower}≧猛威${climax.menace}）。京は救われた。`
        : `——大禍、来たる。結界は及ばず（結界力${climax.wardPower}＜猛威${climax.menace}）、京は呑まれた。`,
    );
  }
  for (const r of results) {
    if (r.moved) {
      notableParts.push(`${r.name} が${r.fromPlaceName}から${r.placeName}へ移った。`);
    }
    if (r.stageChanged) {
      const axis = state.characters.find((c) => c.id === r.id)!.growthAxis;
      notableParts.push(
        `${r.name} の段階(${AXIS_LABEL[axis]})が「${r.stageBefore}」→「${r.stageAfter}」に変化。`,
      );
    }
    if (r.died) notableParts.push(`${r.name} が力尽きた。`);
    if (r.forageDraw?.taboo) {
      notableParts.unshift(`${r.name} が${r.placeName}の和みさえ喰らった——禁忌の業。`);
    }
    if (r.deltaReason && Object.keys(r.paramDeltas).length > 0) {
      notableParts.push(`${r.name}: ${r.deltaReason}`);
    }
  }
  // 誰かが移動してきて、同じ場所に2人以上が居合わせた瞬間を強調
  const livingNow = results.filter((r) => !r.died);
  const byPlace = new Map<string, CharacterTickResult[]>();
  for (const r of livingNow) {
    const arr = byPlace.get(r.placeId) ?? [];
    arr.push(r);
    byPlace.set(r.placeId, arr);
  }
  let metUp = false; // 誰かが移動してきて出会いが成立した日か（カメラを寄せる合図）
  for (const members of byPlace.values()) {
    if (members.length >= 2 && members.some((m) => m.moved)) {
      metUp = true;
      notableParts.unshift(
        `${members[0].placeName}で${members.map((m) => m.name).join("と")}が同じ場所に居合わせた。`,
      );
    }
  }
  const notable = notableParts.length > 0 ? notableParts.join(" ") : "特になし";

  // 会話の生成（会話劇の1シーン化）: 「語りかける」が成立した（相手が同室にいる）日だけ、
  //  話し手を交代させながら一発言ずつ積み上げ、一場面の会話を組み立てる。
  //  各ターンは直前までの応酬（history）を見て応えるので、噛み合った会話劇になる。
  let dialogue: DialogueLine[] | undefined;
  if (dialogueProvider) {
    const talker = results.find((r) => r.action === "talk" && !r.died);
    const partner =
      talker && talker.targetId
        ? results.find(
            (r) =>
              r.id === talker.targetId && !r.died && r.placeId === talker.placeId,
          )
        : undefined;
    if (talker && partner) {
      // 口火は語りかけた側。以後この2人で交互に喋る。
      const order: CharacterTickResult[] = [talker, partner];
      const speakersInfo: DialogueSpeaker[] = order.map((r) => ({
        id: r.id,
        action: r.action,
      }));
      const history: DialogueLine[] = [];
      try {
        for (let turn = 0; turn < DIALOGUE_MAX_TURNS; turn++) {
          const speaker = order[turn % 2];
          const { text, end } = await dialogueProvider(
            state,
            weather,
            speakersInfo,
            history,
            speaker.id,
          );
          const line = text?.trim();
          if (!line) break; // 言葉が出なければ打ち切り
          history.push({
            speakerId: speaker.id,
            speakerName: speaker.name,
            text: line,
          });
          // 自然な締めの合図が出たら（最低 DIALOGUE_MIN_TURNS は続けたうえで）終える
          if (end && history.length >= DIALOGUE_MIN_TURNS) break;
        }
        if (history.length > 0) dialogue = history;
      } catch (err) {
        console.error(
          "[dialogue] generation failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // 主役（カメラの視点）の確定。演出家の選択を優先し、無効/未指定なら最も見せ場のある者へ。
  //  死亡した者はその日の死の場面までは主役になりうるが、翌ティック以降は生者から選ばれる（カメラが次へ移る）。
  let spotlightId: string | undefined;
  let spotlightReason = director?.spotlightReason;
  const heroInResults = protagonistId && results.some((r) => r.id === protagonistId);
  if (heroInResults) {
    // 主人公固定: 基本はハル。ただし他者に大事件（死・禁忌・段階変化）があった日だけ、
    //  その日はカメラがそちらへ移る（見せ場の例外移動）。
    const bigOthers = results.filter(
      (r) => r.id !== protagonistId && (r.died || r.forageDraw?.taboo || r.stageChanged),
    );
    if (bigOthers.length > 0) {
      const top = [...bigOthers].sort((a, b) => eventScore(b) - eventScore(a))[0];
      spotlightId = top.id;
      spotlightReason = top.died
        ? `${top.name}の最期`
        : top.forageDraw?.taboo
          ? `${top.name}の禁忌`
          : `${top.name}の段階変化`;
    } else {
      spotlightId = protagonistId;
    }
  } else {
    // 主人公未指定（従来の群像モード）: 演出家の選択 → 見せ場スコア → 2日連続回避
    spotlightId =
      director?.spotlightId && results.some((r) => r.id === director!.spotlightId)
        ? director.spotlightId
        : undefined;
    if (!spotlightId && results.length > 0) {
      spotlightId = [...results].sort((a, b) => eventScore(b) - eventScore(a))[0].id;
    }
    const prevSpotId = recentLog.length
      ? recentLog[recentLog.length - 1].spotlightId
      : undefined;
    if (spotlightId && prevSpotId === spotlightId) {
      const current = results.find((r) => r.id === spotlightId);
      const aliveOthers = results.filter((r) => r.id !== spotlightId && !r.died);
      if (!current?.died && aliveOthers.length > 0) {
        spotlightId = [...aliveOthers].sort((a, b) => eventScore(b) - eventScore(a))[0].id;
      }
    }
  }
  const spot = results.find((r) => r.id === spotlightId);

  // テンポの確定（時間モデル＝シーン駆動・可変テンポ）。
  //  「面白い瞬間」——出会い・会話劇・生存の危機・禁忌・段階変化・衝動・死——があれば
  //  カメラを寄せる（scene）。何もなければ早回し（montage）で1行ステータスだけ流す。
  const tempoReasons: string[] = [];
  if (dialogue && dialogue.length > 0) tempoReasons.push("会話劇");
  if (metUp) tempoReasons.push("出会い");
  for (const e of newWorldEvents) {
    if (e.kind === "calamity") continue; // 大禍は下で専用の理由を立てる
    tempoReasons.push(e.kind === "bounty" ? `${e.name}が京を潤す` : `${e.name}が京を襲う`);
  }
  if (climax) tempoReasons.push(climax.averted ? "大禍を祓い退けた" : "大禍が京を呑んだ");
  for (const r of results) {
    if (r.died) tempoReasons.push(`${r.name}が力尽きた`);
    else if (r.energyAfter <= DANGER_ENERGY) tempoReasons.push(`${r.name}が餓死寸前`);
    if (r.stageChanged) tempoReasons.push(`${r.name}の段階変化`);
    if (r.impulse) tempoReasons.push(`${r.name}の衝動`);
    if (r.forageDraw?.taboo) tempoReasons.push(`${r.name}の禁忌`);
    // 変身・鎮静は観客の見せ場。montage に埋もれて director.narration（地の文）が
    // 観客ビューに出ないのを防ぐため、必ず scene 化する（FrontStage は scene 時のみ narration を表示）。
    if (r.becameFrenzied) tempoReasons.push(`${r.name}の変身`);
    if (r.quelledFrenzy) tempoReasons.push("荒ぶりの鎮め");
  }
  const tempo: Tempo = tempoReasons.length > 0 ? "scene" : "montage";

  return {
    day: state.day,
    weather,
    characters: results,
    tempo,
    tempoReasons,
    notable,
    climax,
    cleared: climax?.averted === true ? true : undefined,
    dialogue,
    director: director
      ? {
          narration: appendFrenzyNarration(director.narration, results),
          intent: director.intent,
          tension,
          forageBoosts: director.forageBoosts,
          directives: director.directives,
        }
      : undefined,
    whispers: whispers.length > 0 ? whispers : undefined,
    worldEvents: state.activeEvents.length > 0 ? state.activeEvents.map((e) => ({ ...e })) : undefined,
    newWorldEvents: newWorldEvents.length > 0 ? newWorldEvents.map((e) => ({ ...e })) : undefined,
    spotlightId,
    spotlightName: spot?.name,
    spotlightReason,
  };
}
