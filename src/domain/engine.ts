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
  DirectorDecision,
  DirectorProvider,
  GuardianProvider,
  GuardianWhisper,
  Place,
  RewardEvent,
  Talent,
  Tension,
  TickResult,
  Weather,
  WorldState,
} from "./types.ts";
import { ACTION_LABELS } from "./types.ts";
import { distance, findPlace, isNeighbor, stepToward } from "./places.ts";
import {
  AXIS_LABEL,
  DAILY_LOAD,
  LEAN_PROBABILITY,
  NEEDS_PARTNER,
  REWARD,
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
  if (living.some((c) => c.energy <= 12)) return "tragic";

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
function drawForagePool(place: Place, weather: Weather, boost: number, talent: Talent): ForageDraw {
  const cap = Math.max(
    0,
    (weather === "normal" ? place.forage.normal : place.forage.lean) + boost,
  );
  if (cap <= 0) return { gain: 0, sei: 0, daku: 0, taboo: false };

  if (talent === "devour") {
    const want = Math.round(cap * 1.6); // 多く喰らう
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
}

export async function runTick(
  state: WorldState,
  recentWeather: Weather[],
  provider: DecisionProvider,
  opts: RunTickOptions = {},
): Promise<TickResult> {
  const { dialogueProvider, directorProvider, guardianProvider, recentLog = [] } = opts;
  const rng = opts.rng ?? Math.random;

  state.day += 1;

  // 0. 演出家の介入（環境＋守護神への指示）。緊張度を読む。
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

  // 場所ごとの実り一時増減（演出家の介入）
  const forageBoost = new Map<string, number>();
  for (const b of director?.forageBoosts ?? []) {
    forageBoost.set(b.placeId, (forageBoost.get(b.placeId) ?? 0) + b.delta);
  }

  // 民の霊力は日ごとにゆっくり回復する（枯れた地も時を経て息を吹き返す）
  for (const p of state.places) {
    p.populace.sei = Math.min(p.populaceMax.sei, p.populace.sei + p.regen.sei);
    p.populace.daku = Math.min(p.populaceMax.daku, p.populace.daku + p.regen.daku);
  }

  // 集霊の結果（取れ高の内訳）。step4 で1度だけ引き、報酬・表示で使い回す。
  const forageDrawById = new Map<string, ForageDraw>();
  const doForage = (actor: Character, place: Place): number => {
    const boost = forageBoost.get(place.id) ?? 0;
    const r = drawForagePool(place, weather, boost, actor.talent);
    forageDrawById.set(actor.id, r);
    return r.gain;
  };

  const living = state.characters.filter((c) => c.alive);
  const placeName = (id: string): string =>
    findPlace(state.places, id)?.name ?? id;

  // 1. 負荷（−8）を生者全員に適用
  const energyBefore = new Map<string, number>();
  for (const c of living) {
    energyBefore.set(c.id, c.energy);
    c.energy -= DAILY_LOAD;
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
      if (d.action === "move") {
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
    // forage（集霊）は民の霊力プールから引く。それ以外は固定効果。
    actor.energy += action === "forage" ? doForage(actor, place) : eff.self;
    if (target && eff.partner !== 0) target.energy += eff.partner;
    // ナギ（結の力）が気を鎮める（休む）と、その地の清霊を癒し戻す
    if (actor.talent === "bond" && action === "rest") {
      place.populace.sei = Math.min(place.populaceMax.sei, place.populace.sei + BOND_HEAL);
    }
  }

  // 5. パラメータ変動を適用（±5・最大2項目に安全化）
  for (const actor of living) {
    const d = decisionById.get(actor.id);
    if (!d) continue;
    const safeDeltas = sanitizeParamDeltas(d.paramDeltas);
    d.paramDeltas = safeDeltas;
    actor.params = applyDeltas(actor.params, safeDeltas);
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
          raw.push({ channel: "thrill", label: `${place.name}で濁霊を${dr.daku}喰らった`, base: dr.daku });
        }
        if (dr.sei > 0) {
          raw.push({ channel: "thrill", label: `${place.name}で清き霊を${dr.sei}喰らった（禁忌）`, base: dr.sei });
          raw.push({ channel: "stress", label: "清き霊を穢した業がのしかかる", base: -Math.round(dr.sei * 0.6) });
        }
        if (dr.gain === 0) {
          raw.push({ channel: "stress", label: `${place.name}には喰らう霊も残っていない`, base: -3 });
        }
      } else {
        const label =
          dr.gain > 0
            ? `${place.name}で清霊を${dr.gain}頂いた`
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
    } else if (act === "deceive") {
      raw.push({ channel: "thrill", label: target ? `${target.name}を欺いた` : "欺いた", base: REWARD.illicit });
    }

    // 他者の行動から受ける報酬/被害（自分を相手に選んだ者すべてから）
    for (const o of actorsTargeting(actor)) {
      const oAct = resolved.get(o.id)?.action;
      if (oAct === "share") {
        raw.push({ channel: "bond", label: `${o.name}から分けてもらった`, base: REWARD.shareReceived });
      } else if (oAct === "steal") {
        raw.push({ channel: "stress", label: `${o.name}に奪われた`, base: REWARD.victim });
      } else if (oAct === "deceive") {
        raw.push({ channel: "stress", label: `${o.name}に欺かれた`, base: REWARD.victim });
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
      memo = `Day${state.day}: ${placeName(r.fromPlaceId!)}から${placeLabel}へ移動`;
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
      } else if (action === "deceive" && pName) {
        memo = base + `${pName}を欺いた`;
      } else {
        memo = base + ACTION_LABELS[action];
      }
      if (died) memo += "（力尽きた）";
    }
    pushEpisodic(actor, memo);

    const isPersonal = action === "talk" || action === "share" || action === "steal" || action === "deceive";

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
      fromPlaceName: r.moved ? placeName(r.fromPlaceId!) : undefined,
      withPartner,
      targetId: isPersonal ? target?.id : undefined,
      targetName: isPersonal ? target?.name : undefined,
      forageDraw: action === "forage" ? forageDrawById.get(actor.id) : undefined,
      impulse: impulseIds.has(actor.id),
      rewardEvents: rewardEventsById.get(actor.id) ?? [],
      mood: { ...actor.mood },
      antibodies: { ...actor.antibodies },
    });
  }

  // 7. 終了判定（生者1人以下）
  if (state.characters.filter((c) => c.alive).length <= 1) {
    state.finished = true;
  }

  // 注目の変化（plan.md 第10節）
  const notableParts: string[] = [];
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
      notableParts.unshift(`${r.name} が${r.placeName}の清き霊を喰らった——禁忌の業。`);
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
  for (const members of byPlace.values()) {
    if (members.length >= 2 && members.some((m) => m.moved)) {
      notableParts.unshift(
        `${members[0].placeName}で${members.map((m) => m.name).join("と")}が同じ場所に居合わせた。`,
      );
    }
  }
  const notable = notableParts.length > 0 ? notableParts.join(" ") : "特になし";

  // 会話の生成: 「語りかける」が成立した（相手が同室にいる）日だけ、その2人の短い会話を作る
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
      try {
        const raw = await dialogueProvider(state, weather, [
          { id: talker.id, action: talker.action },
          { id: partner.id, action: partner.action },
        ]);
        const validIds = new Set([talker.id, partner.id]);
        const lines = raw
          .filter((l) => validIds.has(l.speaker) && l.text?.trim())
          .slice(0, 8)
          .map((l) => ({
            speakerId: l.speaker,
            speakerName:
              state.characters.find((c) => c.id === l.speaker)?.name ?? l.speaker,
            text: l.text.trim(),
          }));
        if (lines.length > 0) dialogue = lines;
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
  let spotlightId =
    director?.spotlightId && results.some((r) => r.id === director!.spotlightId)
      ? director.spotlightId
      : undefined;
  if (!spotlightId && results.length > 0) {
    spotlightId = [...results].sort((a, b) => eventScore(b) - eventScore(a))[0].id;
  }
  // カメラは2日続けて同じ人物に留めない（群像として日ごとに視点を移す）。
  //  例外: その人物が今日退場（死亡）した＝死の場面、または他に生存者がいない場合は留まる。
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
  const spot = results.find((r) => r.id === spotlightId);

  return {
    day: state.day,
    weather,
    characters: results,
    notable,
    dialogue,
    director: director
      ? {
          narration: director.narration,
          intent: director.intent,
          tension,
          forageBoosts: director.forageBoosts,
          directives: director.directives,
        }
      : undefined,
    whispers: whispers.length > 0 ? whispers : undefined,
    spotlightId,
    spotlightName: spot?.name,
    spotlightReason: director?.spotlightReason,
  };
}
