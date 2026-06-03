// 回帰（ローグライク）ランナー。主人公ハルが力尽きるたびに世界を Day1 へ巻き戻し、
// 周回番号を進める。記憶・成長値・異能はリセットされ、唯一スキルだけが持ち越される。
// CLI（sim.ts）と Web（server.ts）の双方がこのランナーを使い、回帰ロジックを二重化しない。
import type {
  ChannelMap,
  Chronicle,
  FrenzyState,
  LocalizedText,
  LoopSummary,
  Params,
  Populace,
  SkillEffects,
  TickResult,
  Weather,
  WorldEvent,
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
import { loopMetaHighlights } from "./highlights.ts";

const DEFAULT_PROTAGONIST = "haru";

/**
 * キャラの「可変状態」だけ（不変の設定＝core/voice/talent/sensitization 等はコード
 * createInitialCharacters() が持つので保存しない）。復元時に id で世界へ上書きする。
 */
export interface CharSave {
  id: string;
  energy: number;
  stealBurden: number;
  params: Params;
  alive: boolean;
  currentPlaceId: string;
  mood: { elation: number; calm: number; warmth: number; stress: number };
  antibodies: ChannelMap;
  currentWhisper?: string;
  whisperIgnored?: number;
  relationLabel: string;
  episodicMemory: string[];
  diary: LocalizedText[];
  /** ココロ（kind.id→受領回数）。周またぎ持ち越しはハルだけ（freshWorldFor 参照）。 */
  soulCounters: Record<string, number>;
  /** 荒ぶり（変身）状態。半妖カイのみ持つ（他キャラは undefined）。周内のみ・回帰でリセット。 */
  frenzy?: FrenzyState;
}

/** 場所の「可変状態」だけ（地形・隣接・実り上限はコード placesCopy() が持つ）。 */
export interface PlaceSave {
  id: string;
  populace: Populace;
}

/**
 * 回帰ランナーのセーブ状態。DB へ正規化テーブルで保存・復元する（巨大 JSON スナップショットは廃止）。
 * ここに含めないもの:
 *  - 不変の設定（places の地形・キャラ定義）→ コードを正とし、復元時に再構成する。
 *  - ログ（loopLog / weatherHistory）→ 現周の ticks 行から再構成する。
 * 含めるのは「コードにもログにも無い・派生不能な状態」だけ。
 */
export interface CampaignSave {
  chronicle: Chronicle;
  day: number;
  weather: Weather;
  finished: boolean;
  activeEvents: WorldEvent[];
  characters: CharSave[];
  places: PlaceSave[];
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
    heroSoulCounters: {},
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
    hero.params.altruism = clampParam(hero.params.altruism + eff.startAltruismBonus);
    // ココロはハルだけ周をまたいで持ち越す（値コピーで独立させる）。他キャラは空 {} のまま。
    hero.soulCounters = { ...chronicle.heroSoulCounters };
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

  /** 永続化用のセーブ状態を取り出す（DB へ正規化保存。設定とログは含めない）。 */
  save(): CampaignSave {
    const w = this.world;
    return {
      chronicle: this.chronicle,
      day: w.day,
      weather: w.weather,
      finished: w.finished,
      activeEvents: w.activeEvents,
      characters: w.characters.map((c) => ({
        id: c.id,
        energy: c.energy,
        stealBurden: c.stealBurden,
        params: c.params,
        alive: c.alive,
        currentPlaceId: c.currentPlaceId,
        mood: c.mood,
        antibodies: c.antibodies,
        currentWhisper: c.currentWhisper,
        whisperIgnored: c.whisperIgnored,
        relationLabel: c.relationLabel,
        episodicMemory: c.episodicMemory,
        diary: c.diary,
        soulCounters: c.soulCounters,
        frenzy: c.frenzy,
      })),
      places: w.places.map((p) => ({ id: p.id, populace: p.populace })),
    };
  }

  /**
   * セーブ状態から復元する。世界の「設定」はコード（freshWorldFor＝placesCopy/
   * createInitialCharacters）を正として組み直し、その上に保存済みの可変状態を id で上書きする。
   * ログ（loopLog/weatherHistory）は現周の ticks 行（loopTicks）から再構成する。
   */
  static restore(save: CampaignSave, loopTicks: TickResult[] = []): Campaign {
    const c = new Campaign(save.chronicle); // world = 設定＋ロスターをコードから構築
    const w = c.world;
    w.day = save.day;
    w.weather = save.weather;
    w.finished = save.finished;
    w.activeEvents = save.activeEvents;

    const placeIds = new Set(w.places.map((p) => p.id));
    for (const cs of save.characters) {
      const ch = w.characters.find((x) => x.id === cs.id);
      if (!ch) continue; // ロスター外（未解放）なら無視
      ch.energy = cs.energy;
      // 旧DB（steal_burden 列が無い周）は移行で 0 に backfill 済み → そのまま採用
      ch.stealBurden = cs.stealBurden;
      ch.params = cs.params;
      ch.alive = cs.alive;
      // 居場所が（マップ縮小などで）消えていたら、黙って壊さずコード既定の初期地へ戻して警告する
      if (placeIds.has(cs.currentPlaceId)) {
        ch.currentPlaceId = cs.currentPlaceId;
      } else {
        console.warn(
          `[restore] ${cs.id} の居場所「${cs.currentPlaceId}」は現マップに存在しない。初期地「${ch.currentPlaceId}」へ戻す。`,
        );
      }
      ch.mood = cs.mood;
      ch.antibodies = cs.antibodies;
      ch.currentWhisper = cs.currentWhisper;
      ch.whisperIgnored = cs.whisperIgnored;
      ch.relationLabel = cs.relationLabel;
      ch.episodicMemory = cs.episodicMemory;
      ch.diary = cs.diary;
      ch.soulCounters = cs.soulCounters; // ココロ（kind→受領回数）
      // 荒ぶり（変身）。保存があれば上書き（旧DB＝未保存ならコード既定の初期 frenzy を残す＝0/未変身）。
      if (cs.frenzy) ch.frenzy = cs.frenzy;
    }
    for (const ps of save.places) {
      const p = w.places.find((x) => x.id === ps.id);
      if (p) p.populace = ps.populace; // 消えた地は捨てる
    }

    c.loopLog = loopTicks;
    c.weatherHistory = loopTicks.map((t) => t.weather);
    c.loopDays = loopTicks.length;
    const heroId = save.chronicle.protagonistId;
    c.loopMaxAltruism = loopTicks.reduce((mx, t) => {
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
      // ココロの通算受領をハルだけ持ち越す。runTick が world を更新済みなので world のハルが
      // 今周の最新値を持つ（各 kind 単調増加）。値コピーで chronicle に書き戻す。
      const heroSoul = this.hero()?.soulCounters;
      if (heroSoul) this.chronicle.heroSoulCounters = { ...heroSoul };
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

    // 周末判定: 30日目の大禍を祓い退けたらクリア、主人公が力尽きたら回帰。どちらも周を閉じて次周へ。
    //  クリアを死亡より先に見る（結界が届けば、同じ日に通常負荷で倒れていても勝ちを取りこぼさない）。
    const heroDied = heroResult?.died ?? !(this.hero()?.alive ?? false);
    if (result.cleared) {
      // 大禍を祓い退けて京を救った。勝利を刻み、次の周（また30日のカウントダウン）を立ち上げる。
      this.closeLoop("大禍を祓い、京を救った", { kind: "cleared" });
    } else if (heroDied) {
      result.regressed = true;
      this.closeLoop(heroResult ? `${heroResult.placeName}で力尽きた` : "力尽きた", {
        kind: "died",
        placeId: heroResult?.placeId,
      });
    }
  }

  /**
   * 周回を閉じ、履歴に結末を刻んで次周の世界を立ち上げる。
   * causeOfEnd は日本語の source of truth（JP フォールバック表示用）。
   * end は i18n 用の構造化（kind＝クリア/力尽き、placeId＝力尽きた場所）。
   */
  private closeLoop(
    causeOfEnd: string,
    end: { kind: "cleared" | "died"; placeId?: string },
  ): void {
    const summary: LoopSummary = {
      loop: this.chronicle.loop,
      days: this.loopDays,
      causeOfEnd,
      endKind: end.kind,
      endPlaceId: end.placeId,
      altruismReached: this.loopMaxAltruism,
      stageReached: stageOf(this.loopMaxAltruism),
      acquiredSkills: [...this.chronicle.skills.acquired],
      cleared: end.kind === "cleared" || undefined,
      // 全周ログを常駐させない設計のため、回帰を超えた年代記用の節目（会得・解放・段階到達）を
      // この周のログから日付付きで焼き付けておく（次周以降は loopLog がリセットされるので今ここで）。
      metaHighlights: loopMetaHighlights(this.loopLog, this.protagonistId),
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
