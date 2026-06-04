// スキル＝回帰（ローグライク）をまたいで持ち越す唯一のもの（plan.md「終わらなさ」）。
// 記憶・成長値・異能は周回ごとにリセットされるが、ここで定義する「獲得式スキル」だけが
// 永続する。ハルが経験で条件を満たした瞬間に習得し、以後は全周にわたり効き続ける。
// 効果はすべて主人公（ハル）にのみ適用される。
import type {
  Chronicle,
  SkillDef,
  SkillEffects,
  SkillId,
  SkillProfile,
  SkillTickContext,
} from "./types.ts";
import { CHARACTER_UNLOCKS } from "./characters.ts";
import { findSoulKind, soulStageOf } from "./soul.ts";

/**
 * fin への鍵条件（「捨て身の守り」の進捗ゲート）。
 * 全キャラが解放済みで、かつハルのココロ（利他の心）が最終段階「満ちる」に達しているか。
 * 大禍を祓えること＝物語が完成していることを構造的に保証するため、結界力を 30 に届かせる
 * 最後のスキルの会得条件にこれを編み込む（クリア＝回帰の輪を断つ＝fin）。
 */
function finKeyConditionMet(chronicle: Chronicle): boolean {
  const allUnlocked = CHARACTER_UNLOCKS.every((u) => chronicle.roster.includes(u.id));
  const kind = findSoulKind("altruism");
  // ココロ定義が消えているのはコード矛盾（鍵条件が永遠に満たせなくなる）。隠さず止める。
  if (!kind) throw new Error("ココロ『利他の心』(altruism) が SOUL_KINDS に存在しない");
  const stage = soulStageOf(kind, chronicle.heroSoulCounters["altruism"] ?? 0);
  const soulFull = (stage?.level ?? 0) >= 3;
  return allUnlocked && soulFull;
}

/**
 * スキルレジストリ。ハル（成長軸=利他 / 異能=観の眼 / 殻を破り独占を憎む）のテーマに沿う。
 * measure はその日の主人公の結果を見て「進捗の増分」を返す。
 */
export const SKILLS: SkillDef[] = [
  {
    id: "share_taste",
    icon: "🍵",
    name: "分かち合いの味",
    description: "1周のうちに霊力を3度分け与えると会得。以後、分けるときの自己消費が軽くなる。",
    scope: "loop",
    threshold: 3,
    measure: ({ hero }) => (hero.action === "share" && hero.targetId ? 1 : 0),
    effect: { shareSelfReduction: 3 },
  },
  {
    id: "insight_edge",
    icon: "👁️",
    name: "観の眼・冴え",
    description: "通算30度の集霊で会得（周をまたいで蓄積）。霊脈を読む眼が冴え、集霊の取れ高が+15%。",
    scope: "career",
    threshold: 30,
    measure: ({ hero }) => (hero.action === "forage" ? 1 : 0),
    effect: { forageBonus: 0.15 },
  },
  {
    id: "beyond_hunger",
    icon: "🔥",
    name: "飢えを越えた者",
    description: "1周のうちに餓死寸前（霊力12以下）から3度生還すると会得。日々の負荷が1軽くなる。",
    scope: "loop",
    threshold: 3,
    measure: ({ hero }) => (!hero.died && hero.energyAfter <= 12 ? 1 : 0),
    effect: { loadReduction: 1 },
  },
  {
    id: "binding_hands",
    icon: "🤝",
    name: "結ぶ手",
    description: "通算5度、語りかけが心を通わせると会得（周をまたいで蓄積）。次周以降、信頼+10で目覚める。",
    scope: "career",
    threshold: 5,
    measure: ({ hero }) =>
      hero.action === "talk" && hero.rewardEvents.some((e) => e.channel === "bond") ? 1 : 0,
    effect: { startTrustBonus: 10 },
  },
  // 旧効果は開始霊力+10（startEnergyBonus）。周全体で固定+10にしかならず、生存14〜23日の
  // 実測では11日目以降つねに負荷-1が勝つ（+4〜13差）ため、30日到達を支える持続効果へ載せ替えた。
  // loadReduction は base 負荷(6)にのみ効き、終盤の災害激化・大禍・業には効かない（engine の
  // 負荷式参照）ので、ジリ貧を一段緩めつつ緊張感の源泉は保たれる。
  {
    id: "sever_solitude",
    icon: "💞",
    name: "独りを断つ",
    description:
      "利他が「成熟」（70以上）に届いた周を一度でも達成すると会得。もう独りではない——孤独の重さがほどけ、以後は日々の負荷が1軽くなる。",
    scope: "career",
    threshold: 1,
    measure: ({ hero }) => (hero.paramsAfter.altruism >= 70 ? 1 : 0),
    effect: { loadReduction: 1 },
  },
  {
    id: "warded_heart",
    icon: "🪨",
    name: "奪われぬ芯",
    description: "通算3度、誰かに霊力を奪われると会得（周をまたいで蓄積）。奪われ慣れた芯が穢れを弾き、以後は奪われても霊力の損とストレスが半分で済む。",
    scope: "career",
    threshold: 3,
    measure: ({ hero }) => (hero.wasStolenFrom ? 1 : 0),
    effect: { stealResist: 0.5 },
  },
  // --- 結界スキル（30日目の大禍を祓い退けるための「結界力 wardPower」を積む）---
  // 結界は「心得」（基礎・単独周でも進む）と「捨て身の守り」（鍵）の2つだけ。
  // 合計 14+18=32 ≥ 猛威度30 だが、鍵には fin の物語条件（全キャラ解放＋ココロ満ちる）が
  // 編み込まれているため、物語が完成するまで大禍は決して祓えない。
  // 祓えた周＝回帰する理由が消えた周＝fin（campaign.recordTick が輪を断つ）。
  {
    id: "ward_basics",
    icon: "🛡️",
    name: "結界の心得",
    description: "通算8度、祓い清めると会得（周をまたいで蓄積）。荒れた地を鎮める手が結界の基礎となり、大禍への結界力+14。",
    scope: "career",
    threshold: 8,
    measure: ({ hero }) => (hero.action === "purify" ? 1 : 0),
    effect: { wardPower: 14 },
  },
  // 旧「静坐の澄み」（さらに旧「守りの静坐」）。rest 条件＋restBonus は実データで完全な死に
  // スキルだった（18周・延べ約270日でハルが rest を選んだ日が一度も無く進捗 0/10）。
  // 毎周必ず起きている「死」そのものを糧にする生存スキルへ再改装した
  // （id は DB の進捗・i18n キーとの互換のため据え置き）。
  {
    id: "ward_vigil",
    icon: "🕯️",
    name: "九死の灯",
    description:
      "通算5度、力尽きると会得（周をまたいで蓄積）。幾度もの死の記憶が魂に灯を残し、以後は一周に一度だけ、力尽きるその刹那を霊力1で踏みとどまる。",
    scope: "career",
    threshold: 5,
    measure: ({ hero }) => (hero.died ? 1 : 0),
    effect: { deathWard: 1 },
  },
  // 旧「守りの絆」。同じく結界力を外し、分かち合いの記憶が次の生へ宿る成長スキルへ改装
  // （startAltruismBonus は freshWorldFor が周開始時に適用する。利他はココロ・カイ解放・
  //  「独りを断つ」と連動するため、fin 本線への間接支援になる）。
  {
    id: "ward_bonds",
    icon: "🪢",
    name: "絆の温もり",
    description: "通算12度、霊力を分け与えると会得（周をまたいで蓄積）。人と分かち合った温もりが魂に宿り、次周以降は利他+5で目覚める。",
    scope: "career",
    threshold: 12,
    measure: ({ hero }) => (hero.action === "share" && hero.targetId ? 1 : 0),
    effect: { startAltruismBonus: 5 },
  },
  // fin への鍵。この進捗は「全キャラ解放＋ココロ満ちる」の周でしか進まない（finKeyConditionMet）。
  // 会得すれば結界力 14+18=32 ≥ 猛威度30 となり、次の30日目で大禍を祓える＝輪を断てる。
  {
    id: "ward_resolve",
    icon: "🦸",
    name: "捨て身の守り",
    description:
      "全ての仲間と出会い、ココロ（利他の心）が満ちた者の寄り添いだけが糧になる。その状態で通算6度、誰かに寄り添うと会得（周をまたいで蓄積）。輪を断つ覚悟が結界を結び、大禍への結界力+18。",
    scope: "career",
    threshold: 6,
    measure: ({ hero, chronicle }) =>
      hero.action === "follow" && finKeyConditionMet(chronicle) ? 1 : 0,
    effect: { wardPower: 18 },
  },
  // --- 鎮めの術（荒ぶる半妖カイを祓い鎮める「鎮めの力 quellPower」を積む。結界 wardPower の双子）---
  // 荒ぶるカイと同じ霊地でハルが祓った日だけ進む。ward_basics の素の purify とは差別化し、
  // 「カイと向き合った経験」だけが術になる。会得すれば quellPower=14 で FRENZY_MAX(12) を上回り確実に鎮められる。
  {
    id: "quell_art",
    icon: "🕊️",
    name: "鎮めの術",
    description:
      "荒ぶる半妖と同じ霊地で向き合い、通算5度その地を祓うと会得（周をまたいで蓄積／鎮め損ねた日も糧になる）。荒ぶりを解く鎮めの力＝quellPower+14。",
    scope: "career",
    threshold: 5,
    // facedFrenzy: ハルが荒ぶる者と同じ地で祓った日（engine 4.5 で鎮め成否を問わず立つ）。
    // 鎮めた日も含めて数えるため、鎮め判定で active=false になっても進捗を取りこぼさない。
    measure: ({ hero }) => (hero.facedFrenzy ? 1 : 0),
    effect: { quellPower: 14 },
  },
  // --- 涸らさぬ手（分与で自らを削る者を涸れさせない「返霊 shareReflect」。鎮めの術の双子）---
  // ナギは利他が成熟すると弱った者（最優先はハル）へ霊力を分け与え、自己消費(-10)で枯れていく。
  // ハルが分与をその身に受けた経験が術となり、会得後は分けてくれた相手（share元＝主にナギ）へ
  // 霊力を返し、与え手の身を涸らさない。荒ぶりを完全に解く鎮めの術と対をなす「完全救済」。
  {
    id: "never_dry",
    icon: "🤲",
    name: "涸らさぬ手",
    description:
      "誰かの分け与えをその身に通算5度受けると会得（周をまたいで蓄積）。以後、ハルが霊力を分けてもらったとき、削って分けてくれた相手にも霊力を返し（返霊+10）、その身を涸らさない。",
    scope: "career",
    threshold: 5,
    // ハルが share の受け手になった日に進む。share元の記録（action==="share" かつ targetId がハル）で判定し、
    // ハル自身の行動に依らず「分けてもらった経験」だけを糧にする（鎮めの術 facedFrenzy と同じ作法）。
    measure: ({ hero, result }) =>
      result.characters.some((c) => c.action === "share" && c.targetId === hero.id) ? 1 : 0,
    effect: { shareReflect: 10 },
  },
];

const SKILL_BY_ID = new Map<SkillId, SkillDef>(SKILLS.map((s) => [s.id, s]));

export function findSkill(id: SkillId): SkillDef | undefined {
  return SKILL_BY_ID.get(id);
}

/** まっさらなスキルプロフィール（1周目の開始時） */
export function freshSkillProfile(): SkillProfile {
  const progress: Record<SkillId, number> = {};
  for (const s of SKILLS) progress[s.id] = 0;
  return { acquired: [], progress };
}

/**
 * その日の文脈から、まだ習得していないスキルの進捗を進める。
 * 閾値に届いたものは acquired に加え、「この日新たに会得したスキル定義」を返す。
 * Chronicle.skills を破壊的に更新する。
 */
export function advanceSkills(chronicle: Chronicle, ctx: SkillTickContext): SkillDef[] {
  const prof = chronicle.skills;
  const newly: SkillDef[] = [];
  for (const skill of SKILLS) {
    if (prof.acquired.includes(skill.id)) continue;
    const inc = skill.measure(ctx);
    if (inc !== 0) {
      prof.progress[skill.id] = (prof.progress[skill.id] ?? 0) + inc;
    }
    if ((prof.progress[skill.id] ?? 0) >= skill.threshold) {
      prof.acquired.push(skill.id);
      newly.push(skill);
    }
  }
  return newly;
}

/**
 * 周回が閉じるときに、loop スコープの（＝未習得の）進捗カウンタをリセットする。
 * career スコープと習得済みはそのまま持ち越す。
 */
export function resetLoopScopedProgress(chronicle: Chronicle): void {
  const prof = chronicle.skills;
  for (const skill of SKILLS) {
    if (skill.scope === "loop" && !prof.acquired.includes(skill.id)) {
      prof.progress[skill.id] = 0;
    }
  }
}

/** 効果なし（スキル未習得・回帰機能オフ時のデフォルト） */
export function noSkillEffects(): SkillEffects {
  return {
    loadReduction: 0,
    forageMult: 1,
    shareSelfReduction: 0,
    startEnergyBonus: 0,
    startTrustBonus: 0,
    startAltruismBonus: 0,
    deathWard: 0,
    wardPower: 0,
    stealResist: 0,
    quellPower: 0,
    shareReflect: 0,
  };
}

/** 習得済みスキルの効果を合算し、engine / freshWorldFor が読む実効効果にする。 */
export function aggregateEffects(acquired: SkillId[]): SkillEffects {
  const eff = noSkillEffects();
  for (const id of acquired) {
    const skill = SKILL_BY_ID.get(id);
    if (!skill) continue;
    const e = skill.effect;
    if (e.loadReduction) eff.loadReduction += e.loadReduction;
    if (e.forageBonus) eff.forageMult += e.forageBonus;
    if (e.shareSelfReduction) eff.shareSelfReduction += e.shareSelfReduction;
    if (e.startEnergyBonus) eff.startEnergyBonus += e.startEnergyBonus;
    if (e.startTrustBonus) eff.startTrustBonus += e.startTrustBonus;
    if (e.startAltruismBonus) eff.startAltruismBonus += e.startAltruismBonus;
    if (e.deathWard) eff.deathWard += e.deathWard;
    if (e.wardPower) eff.wardPower += e.wardPower;
    if (e.stealResist) eff.stealResist += e.stealResist;
    if (e.quellPower) eff.quellPower += e.quellPower;
    if (e.shareReflect) eff.shareReflect += e.shareReflect;
  }
  // 奪われ被害の軽減割合は 0〜1 に収める（将来複数スキルが重なっても全損化させない）
  eff.stealResist = Math.min(1, eff.stealResist);
  return eff;
}
