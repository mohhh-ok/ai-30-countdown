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
  {
    id: "sever_solitude",
    icon: "💞",
    name: "独りを断つ",
    description: "利他が「成熟」（70以上）に届いた周を一度でも達成すると会得。次周以降、霊力+10で目覚める。",
    scope: "career",
    threshold: 1,
    measure: ({ hero }) => (hero.paramsAfter.altruism >= 70 ? 1 : 0),
    effect: { startEnergyBonus: 10 },
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
  {
    id: "pathfinder",
    icon: "🧭",
    name: "道を知る者",
    description: "通算20度、足で移動すると会得（周をまたいで蓄積）。独りの渓を出て他者へ向かう歩みに体が慣れ、日々の負荷が1軽くなる。",
    scope: "career",
    threshold: 20,
    measure: ({ hero }) => (hero.action === "move" ? 1 : 0),
    effect: { loadReduction: 1 },
  },
  // --- 結界スキル（30日目の大禍を祓い退けるための「結界力 wardPower」を積む）---
  // 単独（ハルひとり）の周でも、祓い×8 と 休む×10 だけで wardPower 18+14=32 ≥ 猛威度30 に届く設計。
  // 仲間が解放されれば、分与・寄り添いの道でも結界を編める。
  {
    id: "ward_basics",
    icon: "🛡️",
    name: "結界の心得",
    description: "通算8度、祓い清めると会得（周をまたいで蓄積）。荒れた地を鎮める手が結界の基礎となり、大禍への結界力+18。",
    scope: "career",
    threshold: 8,
    measure: ({ hero }) => (hero.action === "purify" ? 1 : 0),
    effect: { wardPower: 18 },
  },
  {
    id: "ward_vigil",
    icon: "🪷",
    name: "守りの静坐",
    description: "通算10度、身を鎮めて休むと会得（周をまたいで蓄積）。澄んだ静けさが心の備えとなり、大禍への結界力+14。",
    scope: "career",
    threshold: 10,
    measure: ({ hero }) => (hero.action === "rest" ? 1 : 0),
    effect: { wardPower: 14 },
  },
  {
    id: "ward_bonds",
    icon: "🪢",
    name: "守りの絆",
    description: "通算12度、霊力を分け与えると会得（周をまたいで蓄積）。人と結んだ絆が盾となり、大禍への結界力+12。",
    scope: "career",
    threshold: 12,
    measure: ({ hero }) => (hero.action === "share" && hero.targetId ? 1 : 0),
    effect: { wardPower: 12 },
  },
  {
    id: "ward_resolve",
    icon: "🦸",
    name: "捨て身の守り",
    description: "通算6度、誰かに寄り添うと会得（周をまたいで蓄積）。傍に在り支える覚悟が力に変わり、大禍への結界力+14。",
    scope: "career",
    threshold: 6,
    measure: ({ hero }) => (hero.action === "follow" ? 1 : 0),
    effect: { wardPower: 14 },
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
    wardPower: 0,
    stealResist: 0,
    quellPower: 0,
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
    if (e.wardPower) eff.wardPower += e.wardPower;
    if (e.stealResist) eff.stealResist += e.stealResist;
    if (e.quellPower) eff.quellPower += e.quellPower;
  }
  // 奪われ被害の軽減割合は 0〜1 に収める（将来複数スキルが重なっても全損化させない）
  eff.stealResist = Math.min(1, eff.stealResist);
  return eff;
}
