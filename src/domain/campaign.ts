// 回帰（ローグライク）ランナー。主人公ハルが力尽きるたびに世界を Day1 へ巻き戻し、
// 周回番号を進める。記憶・成長値・異能はリセットされ、唯一スキルだけが持ち越される。
// CLI（sim.ts）と Web（server.ts）の双方がこのランナーを使い、回帰ロジックを二重化しない。
import type {
  Chronicle,
  LoopSummary,
  SkillEffects,
  TickResult,
  Weather,
  WorldState,
} from "./types.ts";
import { CHARACTER_UNLOCKS, createInitialCharacters } from "./characters.ts";
import { placesCopy } from "./places.ts";
import { clampParam, stageOf } from "./rules.ts";
import {
  advanceSkills,
  aggregateEffects,
  freshSkillProfile,
  resetLoopScopedProgress,
} from "./skills.ts";

const DEFAULT_PROTAGONIST = "haru";

/** 回帰ランナーの永続化スナップショット（DB へ JSON で保存・復元する） */
export interface CampaignSnapshot {
  chronicle: Chronicle;
  world: WorldState;
  weatherHistory: Weather[];
  loopLog: TickResult[];
}

/** まっさらな年代記（1周目の開始。京にはハルだけがいる） */
export function createChronicle(protagonistId = DEFAULT_PROTAGONIST): Chronicle {
  const hero = createInitialCharacters().find((c) => c.id === protagonistId);
  return {
    loop: 1,
    protagonistId,
    skills: freshSkillProfile(),
    roster: [protagonistId],
    heroPeakAltruism: hero?.params.altruism ?? 0,
    history: [],
  };
}

/**
 * 現在の年代記（＝習得スキル・恒久ロスター）を踏まえた新しい WorldState を作る。
 * - 登場するのはロスターに入っているキャラだけ（初期はハルのみ）
 * - スキルの開始ボーナス（エネルギー・信頼）は主人公にのみ盛る
 */
export function freshWorldFor(chronicle: Chronicle): WorldState {
  const characters = createInitialCharacters().filter((c) =>
    chronicle.roster.includes(c.id),
  );
  const eff = aggregateEffects(chronicle.skills.acquired);
  const hero = characters.find((c) => c.id === chronicle.protagonistId);
  if (hero) {
    hero.energy += eff.startEnergyBonus;
    hero.params.trust = clampParam(hero.params.trust + eff.startTrustBonus);
  }
  return {
    day: 0,
    weather: "normal",
    characters,
    places: placesCopy(),
    finished: false,
    activeEvents: [], // 災い/恵みは周回ごとにまっさら
  };
}

/**
 * ハルの現在の到達度（スキル・利他のピーク）から、まだロスターにいないキャラの解放を判定し、
 * 解放されたキャラの id を roster に加える。新たに解放したキャラの定義を返す。
 */
function applyUnlocks(chronicle: Chronicle): { id: string; name: string }[] {
  const newly: { id: string; name: string }[] = [];
  const ctx = {
    acquired: chronicle.skills.acquired,
    peakAltruism: chronicle.heroPeakAltruism,
    loop: chronicle.loop,
  };
  for (const u of CHARACTER_UNLOCKS) {
    if (chronicle.roster.includes(u.id)) continue;
    if (u.isUnlocked(ctx)) {
      chronicle.roster.push(u.id);
      newly.push({ id: u.id, name: u.name });
    }
  }
  return newly;
}

/**
 * 回帰ランナー。world / weatherHistory / 現在周回のログを保持し、
 * 各ティックの結果を受けてスキル進捗を進め、ハル死亡時に巻き戻す。
 */
export class Campaign {
  chronicle: Chronicle;
  world: WorldState;
  weatherHistory: Weather[];
  /** 現在周回のログ（director/tension/spotlight が参照する recentLog 用。回帰でリセット） */
  loopLog: TickResult[];
  private loopMaxAltruism: number;
  private loopDays: number;

  constructor(chronicle: Chronicle = createChronicle()) {
    this.chronicle = chronicle;
    this.world = freshWorldFor(chronicle);
    this.weatherHistory = [];
    this.loopLog = [];
    this.loopMaxAltruism = this.heroAltruism();
    this.loopDays = 0;
  }

  /** 永続化用スナップショットを取り出す（DB へ JSON 保存） */
  snapshot(): CampaignSnapshot {
    return {
      chronicle: this.chronicle,
      world: this.world,
      weatherHistory: this.weatherHistory,
      loopLog: this.loopLog,
    };
  }

  /** スナップショットから復元する（DB からの復帰） */
  static restore(snap: CampaignSnapshot): Campaign {
    const c = new Campaign(snap.chronicle);
    c.world = snap.world;
    c.weatherHistory = snap.weatherHistory;
    c.loopLog = snap.loopLog;
    c.loopDays = snap.loopLog.length;
    const heroId = snap.chronicle.protagonistId;
    c.loopMaxAltruism = snap.loopLog.reduce((mx, t) => {
      const h = t.characters.find((r) => r.id === heroId);
      return h ? Math.max(mx, h.paramsAfter.altruism) : mx;
    }, c.heroAltruism());
    return c;
  }

  get protagonistId(): string {
    return this.chronicle.protagonistId;
  }

  /** 習得スキルを合算した実効効果（runTick に渡す） */
  effects(): SkillEffects {
    return aggregateEffects(this.chronicle.skills.acquired);
  }

  private hero() {
    return this.world.characters.find((c) => c.id === this.protagonistId);
  }

  private heroAltruism(): number {
    return this.hero()?.params.altruism ?? 0;
  }

  /**
   * runTick が返した結果を取り込む。
   * - スキル進捗を進め、会得したものを result.acquiredSkills に載せる
   * - result.loop を付与し、現在周回のログ/天候を更新
   * - ハルが力尽きていれば周回を閉じて Day1 へ巻き戻す（result.regressed=true）
   *
   * world は runTick が破壊的に更新済み。次のティックは this.world を使って続ける。
   */
  recordTick(result: TickResult): void {
    result.loop = this.chronicle.loop;
    this.weatherHistory.push(result.weather);
    this.loopLog.push(result);
    this.loopDays += 1;

    const heroResult = result.characters.find((r) => r.id === this.protagonistId);
    if (heroResult) {
      this.loopMaxAltruism = Math.max(this.loopMaxAltruism, heroResult.paramsAfter.altruism);
      this.chronicle.heroPeakAltruism = Math.max(
        this.chronicle.heroPeakAltruism,
        heroResult.paramsAfter.altruism,
      );
      const newly = advanceSkills(this.chronicle, {
        hero: heroResult,
        result,
        state: this.world,
      });
      if (newly.length > 0) result.acquiredSkills = newly.map((s) => s.name);
      // キャラ解放（ハルの成長・スキル達成で恒久ロスターに加わる。登場は次周 Day1 から）
      const unlocked = applyUnlocks(this.chronicle);
      if (unlocked.length > 0) result.unlockedCharacters = unlocked.map((u) => u.name);
    }

    // 回帰判定: 主人公が力尽きたら、この周を閉じて巻き戻す。
    const heroDied = heroResult?.died ?? !(this.hero()?.alive ?? false);
    if (heroDied) {
      result.regressed = true;
      this.closeLoop(heroResult ? heroResult.placeName : "");
    }
  }

  /** 周回を閉じ、履歴に結末を刻んで次周の世界を立ち上げる。 */
  private closeLoop(heroDeathPlace: string): void {
    const summary: LoopSummary = {
      loop: this.chronicle.loop,
      days: this.loopDays,
      causeOfEnd: heroDeathPlace ? `${heroDeathPlace}で力尽きた` : "力尽きた",
      altruismReached: this.loopMaxAltruism,
      stageReached: stageOf(this.loopMaxAltruism),
      acquiredSkills: [...this.chronicle.skills.acquired],
    };
    this.chronicle.history.push(summary);

    resetLoopScopedProgress(this.chronicle);
    this.chronicle.loop += 1;

    // 次周の世界（記憶・成長値・異能はリセット。スキルの開始ボーナスのみ持ち越し）
    this.world = freshWorldFor(this.chronicle);
    this.weatherHistory = [];
    this.loopLog = [];
    this.loopMaxAltruism = this.heroAltruism();
    this.loopDays = 0;
  }
}
