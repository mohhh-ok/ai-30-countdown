// SQLite 永続化（Drizzle ORM・bun-sqlite ドライバ）。
//
// 設計方針（一系統・サロゲートキー）:
// - runs:         1つの年代記（回帰をまたぐ1セッション）の現在状態。年代記スカラー（周回/日/天候/
//                 主人公/利他ピーク）を列に持つ。可変状態は run_char/run_place/run_skill/run_roster/
//                 run_event/run_loop_summary に正規化して持つ（巨大 JSON スナップショットは廃止）。
//                 設定（地形・キャラ定義）はコードを正とし保存しない。ログは ticks から再構成する。
//                 CLI(sim.ts) と Web(server.ts) の双方がこの同じスキーマに保存する（テーブルは一系統）。
// - ticks:        各日の TickResult を1日1行で保存（表示・復元用）。表示ログはここから ORDER BY で組む。
// - char_metrics: 成長曲線・行動分析用に正規化した1日×1人の薄い行。
// - dialogues:    その日の会話行。
// - llm_timings:  LLM 呼び出し1回ぶんの所要時間（ボトルネック分析）。
// - llm_calls:    LLM 呼び出しの発火ログ（進行中でも「今叩いているか」を見るため）。
// - skill_audit:  スキル会得／キャラ解放の到達可能性監査ログ（毎 tick のスナップ）。
//
// スキーマは src/schema.ts（Drizzle）が正。テーブルの実体化は drizzle-kit push（npm run db:push）で行う。
// 手書きの CREATE TABLE / ALTER マイグレーションは廃止した。
//
// 主キーは全テーブル サロゲート id(AUTOINCREMENT)。回帰で day が周ごとに 1 に戻っても、
// 自然キーを PK にしないので衝突という概念自体が無い。同一 tick の冪等な再保存は
// 「該当 (run_id, loop, day, …) を delete してから insert し直す」で担保する（トランザクション内）。
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";
import { nowISO } from "./time.ts";
import type {
  Chronicle,
  LlmCallTiming,
  LoopSummary,
  SkillProfile,
  TickResult,
  Weather,
  WorldEvent,
} from "./domain/types.ts";
import type { CampaignSave, CharSave, PlaceSave } from "./domain/campaign.ts";

const DB_PATH = process.env.DB_PATH ?? "data/world.db";

// data/ ディレクトリを用意
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {
  /* 既存なら無視 */
}

const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

/** Drizzle インスタンス（全 DB アクセスはこれ経由）。テーブル定義は schema.ts。 */
export const db = drizzle({ client: sqlite, schema });

const {
  runs,
  runSkill,
  runRoster,
  runChar,
  runPlace,
  runEvent,
  runLoopSummary,
  ticks,
  charMetrics,
  dialogues,
  llmTimings,
  llmCalls,
  skillAudit,
} = schema;

/**
 * セーブ状態を正規化テーブルへ書き込む（run 行は別途。ここは状態テーブルのみ）。1トランザクション。
 * スキル/ロスター/キャラ/場所/イベント/履歴は「該当 run を全消し→現在の全件を入れ直し」で同期する。
 */
function writeState(runId: number, save: CampaignSave): void {
  db.transaction((tx) => {
    // スキル進捗（全消し→入れ直し。会得フラグ＋進捗カウンタ）
    tx.delete(runSkill).where(eq(runSkill.runId, runId)).run();
    const skillIds = new Set<string>([
      ...Object.keys(save.chronicle.skills.progress),
      ...save.chronicle.skills.acquired,
    ]);
    const acquiredSet = new Set(save.chronicle.skills.acquired);
    const skillRows = [...skillIds].map((id) => ({
      runId,
      skillId: id,
      acquired: acquiredSet.has(id) ? 1 : 0,
      progress: save.chronicle.skills.progress[id] ?? 0,
    }));
    if (skillRows.length > 0) tx.insert(runSkill).values(skillRows).run();

    // ロスター（全消し→入れ直し）
    tx.delete(runRoster).where(eq(runRoster.runId, runId)).run();
    if (save.chronicle.roster.length > 0) {
      tx.insert(runRoster)
        .values(save.chronicle.roster.map((charId) => ({ runId, charId })))
        .run();
    }

    // キャラ可変状態（全消し→入れ直し）
    tx.delete(runChar).where(eq(runChar.runId, runId)).run();
    if (save.characters.length > 0) {
      tx.insert(runChar)
        .values(save.characters.map((c) => charSaveToRow(runId, c)))
        .run();
    }

    // 場所の枯れ具合（全消し→入れ直し）
    tx.delete(runPlace).where(eq(runPlace.runId, runId)).run();
    if (save.places.length > 0) {
      tx.insert(runPlace)
        .values(
          save.places.map((p) => ({
            runId,
            placeId: p.id,
            sei: p.populace.sei,
            daku: p.populace.daku,
          })),
        )
        .run();
    }

    // 進行中イベント（全消し→入れ直し）
    tx.delete(runEvent).where(eq(runEvent.runId, runId)).run();
    if (save.activeEvents.length > 0) {
      tx.insert(runEvent)
        .values(
          save.activeEvents.map((e, i) => ({
            runId,
            seq: i,
            kind: e.kind,
            name: e.name,
            icon: e.icon,
            remainingDays: e.remainingDays,
            totalDays: e.totalDays,
          })),
        )
        .run();
    }

    // 周回履歴（全消し→入れ直し）
    tx.delete(runLoopSummary).where(eq(runLoopSummary.runId, runId)).run();
    if (save.chronicle.history.length > 0) {
      tx.insert(runLoopSummary)
        .values(
          save.chronicle.history.map((h) => ({
            runId,
            loop: h.loop,
            days: h.days,
            causeOfEnd: h.causeOfEnd,
            endKind: h.endKind ?? null,
            endPlaceId: h.endPlaceId ?? null,
            altruismReached: h.altruismReached,
            stageReached: h.stageReached,
            cleared: h.cleared ? 1 : 0,
            acquiredSkillsJson: JSON.stringify(h.acquiredSkills),
            metaHighlightsJson: h.metaHighlights ? JSON.stringify(h.metaHighlights) : null,
          })),
        )
        .run();
    }
  });
}

/** CharSave → run_char 行（Drizzle insert 値）。 */
function charSaveToRow(runId: number, c: CharSave) {
  return {
    runId,
    charId: c.id,
    energy: c.energy,
    stealBurden: c.stealBurden,
    shareGrace: c.shareGrace,
    deathWardSpent: c.deathWardSpent ? 1 : 0,
    altruism: c.params.altruism,
    independence: c.params.independence,
    trust: c.params.trust,
    alive: c.alive ? 1 : 0,
    placeId: c.currentPlaceId,
    moodElation: c.mood.elation,
    moodCalm: c.mood.calm,
    moodWarmth: c.mood.warmth,
    moodStress: c.mood.stress,
    antiAchievement: c.antibodies.achievement,
    antiBond: c.antibodies.bond,
    antiComfort: c.antibodies.comfort,
    antiThrill: c.antibodies.thrill,
    whisper: c.currentWhisper ?? null,
    whisperIgnored: c.whisperIgnored ?? null,
    relation: c.relationLabel.ja, // 日本語（source of truth・旧データ互換でプレーン文字列）
    relationEn: c.relationLabel.en,
    episodicJson: JSON.stringify(c.episodicMemory),
    diaryJson: JSON.stringify(c.diary),
    soulCountersJson: JSON.stringify(c.soulCounters), // ココロ（kind→受領回数）
    frenzyJson: c.frenzy ? JSON.stringify(c.frenzy) : null, // 荒ぶり（変身）状態（半妖カイのみ。他は null）
  };
}

/** 新しい run を作成して id を返す（年代記スカラーを runs に、可変状態を各テーブルに保存）。 */
export function createRun(save: CampaignSave, model: string): number {
  const row = db
    .insert(runs)
    .values({
      startedAt: nowISO(),
      model,
      lastLoop: save.chronicle.loop,
      lastDay: save.day,
      weather: save.weather,
      protagonistId: save.chronicle.protagonistId,
      heroPeakAltruism: save.chronicle.heroPeakAltruism,
      heroSoulCountersJson: JSON.stringify(save.chronicle.heroSoulCounters),
      pendingRegressJson: save.pendingRegress ? JSON.stringify(save.pendingRegress) : null,
    })
    .returning({ id: runs.id })
    .get();
  const runId = row.id;
  writeState(runId, save);
  return runId;
}

/** run の現在状態を更新（年代記スカラー＋正規化された可変状態）。 */
export function saveRunState(runId: number, save: CampaignSave): void {
  db.update(runs)
    .set({
      finished: save.finished ? 1 : 0,
      lastLoop: save.chronicle.loop,
      lastDay: save.day,
      weather: save.weather,
      heroPeakAltruism: save.chronicle.heroPeakAltruism,
      heroSoulCountersJson: JSON.stringify(save.chronicle.heroSoulCounters),
      pendingRegressJson: save.pendingRegress ? JSON.stringify(save.pendingRegress) : null,
    })
    .where(eq(runs.id, runId))
    .run();
  writeState(runId, save);
}

/** 1ティックの結果を ticks と char_metrics・dialogues に保存（loop は result.loop） */
export function saveTick(runId: number, result: TickResult): void {
  const loop = result.loop ?? 1;
  db.transaction((tx) => {
    // ticks（同一 run/loop/day を消してから入れ直す＝冪等）
    tx.delete(ticks)
      .where(and(eq(ticks.runId, runId), eq(ticks.loop, loop), eq(ticks.day, result.day)))
      .run();
    tx.insert(ticks)
      .values({
        runId,
        loop,
        day: result.day,
        weather: result.weather,
        notable: result.notable,
        resultJson: JSON.stringify(result),
        createdAt: nowISO(),
      })
      .run();

    // char_metrics（同一 run/loop/day を消してから現在の全キャラを入れ直す）
    tx.delete(charMetrics)
      .where(
        and(eq(charMetrics.runId, runId), eq(charMetrics.loop, loop), eq(charMetrics.day, result.day)),
      )
      .run();
    if (result.characters.length > 0) {
      tx.insert(charMetrics)
        .values(
          result.characters.map((c) => ({
            runId,
            loop,
            day: result.day,
            charId: c.id,
            name: c.name,
            action: c.action,
            placeId: c.placeId,
            placeName: c.placeName,
            moved: c.moved ? 1 : 0,
            withPartner: c.withPartner ? 1 : 0,
            energyBefore: c.energyBefore,
            energyAfter: c.energyAfter,
            altruism: c.paramsAfter.altruism,
            independence: c.paramsAfter.independence,
            trust: c.paramsAfter.trust,
            stage: c.stageAfter,
            diary: c.diary.ja,
            diaryEn: c.diary.en,
            diaryNote: c.diaryNote ?? null,
            relation: c.relationLabel.ja, // 分析用は日本語（char_metrics は表示に使わない）
            deltaReason: c.deltaReason,
            died: c.died ? 1 : 0,
            frenzyActive: c.frenzyActive ? 1 : 0,
            becameFrenzied: c.becameFrenzied ? 1 : 0,
          })),
        )
        .run();
    }

    // 会話（あれば）。同一 (run,loop,day) を消してから入れ直す
    tx.delete(dialogues)
      .where(and(eq(dialogues.runId, runId), eq(dialogues.loop, loop), eq(dialogues.day, result.day)))
      .run();
    if (result.dialogue && result.dialogue.length > 0) {
      tx.insert(dialogues)
        .values(
          result.dialogue.map((line, i) => ({
            runId,
            loop,
            day: result.day,
            seq: i,
            speakerId: line.speakerId,
            speakerName: line.speakerName,
            text: line.text.ja,
            textEn: line.text.en,
          })),
        )
        .run();
    }
  });
}

/**
 * 1ティック分の LLM 呼び出し時間を llm_timings に保存する。
 * 同一 (run_id, loop, day) は一度消してから入れ直す（再保存しても重複しない）。
 */
export function saveLlmTimings(
  runId: number,
  loop: number,
  day: number,
  timings: LlmCallTiming[] | undefined,
): void {
  db.transaction((tx) => {
    tx.delete(llmTimings)
      .where(and(eq(llmTimings.runId, runId), eq(llmTimings.loop, loop), eq(llmTimings.day, day)))
      .run();
    const rows = (timings ?? []).map((t, i) => ({
      runId,
      loop,
      day,
      seq: i,
      label: t.label,
      backend: t.backend,
      model: t.model,
      ms: t.ms,
      ok: t.ok ? 1 : 0,
      chars: t.chars,
      createdAt: nowISO(),
    }));
    if (rows.length > 0) tx.insert(llmTimings).values(rows).run();
  });
}

/**
 * LLM 呼び出しを「叩いた瞬間」に記録し、行 id を返す（status='started'）。
 * 失敗してもログのために本処理を止めない（呼び出し側で try/catch する想定だが、二重に保険）。
 */
export function logLlmCallStart(
  label: string,
  backend: string,
  model: string,
  agentic = false,
): number | null {
  try {
    const row = db
      .insert(llmCalls)
      .values({
        startedAt: nowISO(),
        label,
        backend,
        model,
        agentic: agentic ? 1 : 0,
        status: "started",
      })
      .returning({ id: llmCalls.id })
      .get();
    return row?.id ?? null;
  } catch (e) {
    // 握りつぶさず可視化（本処理は止めないが、DB 異常を黙殺しない）
    console.warn("[db] logLlmCallStart failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** 上で開始した呼び出しの完了（成功/失敗）を記録する。id が null なら何もしない。 */
export function logLlmCallEnd(
  id: number | null,
  status: "ok" | "error",
  ms: number,
  chars: number,
  error?: string | null,
): void {
  if (id == null) return;
  try {
    db.update(llmCalls)
      .set({ status, ms, chars, finishedAt: nowISO(), error: error ?? null })
      .where(eq(llmCalls.id, id))
      .run();
  } catch (e) {
    // 握りつぶさず可視化（本処理は止めないが、DB 異常を黙殺しない）
    console.warn("[db] logLlmCallEnd failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * 最新 run を復元する。正規化テーブルから「セーブ状態」を組み立てて返す（設定はコードが正なので
 * 含めない）。現周のログ（loopTicks）は ticks から引いて一緒に返す（Campaign.restore が
 * weatherHistory 等を再構成する）。過去の回帰は loadLoopTicks でオンデマンドに引く。無ければ null。
 */
export function loadLatestRun(): {
  runId: number;
  save: CampaignSave;
  loopTicks: TickResult[];
} | null {
  const run = db.select().from(runs).orderBy(desc(runs.id)).limit(1).get();
  if (!run) return null;
  const runId = run.id;

  // スキル進捗 → SkillProfile
  const skillRows = db.select().from(runSkill).where(eq(runSkill.runId, runId)).all();
  const skills: SkillProfile = {
    acquired: skillRows.filter((r) => r.acquired).map((r) => r.skillId),
    progress: Object.fromEntries(skillRows.map((r) => [r.skillId, r.progress])),
  };

  // 履歴 → LoopSummary[]
  const history: LoopSummary[] = db
    .select()
    .from(runLoopSummary)
    .where(eq(runLoopSummary.runId, runId))
    .orderBy(asc(runLoopSummary.loop))
    .all()
    .map((h) => ({
      loop: h.loop,
      days: h.days,
      causeOfEnd: h.causeOfEnd,
      endKind: (h.endKind as LoopSummary["endKind"]) ?? undefined,
      endPlaceId: h.endPlaceId ?? undefined,
      altruismReached: h.altruismReached,
      stageReached: h.stageReached as LoopSummary["stageReached"],
      acquiredSkills: JSON.parse(h.acquiredSkillsJson),
      cleared: h.cleared ? true : undefined,
      metaHighlights: h.metaHighlightsJson ? JSON.parse(h.metaHighlightsJson) : undefined,
    }));

  const chronicle: Chronicle = {
    loop: run.lastLoop,
    protagonistId: run.protagonistId,
    skills,
    roster: db
      .select()
      .from(runRoster)
      .where(eq(runRoster.runId, runId))
      .all()
      .map((r) => r.charId),
    heroPeakAltruism: run.heroPeakAltruism,
    heroSoulCounters: run.heroSoulCountersJson ? JSON.parse(run.heroSoulCountersJson) : {},
    history,
  };

  // キャラ可変状態 → CharSave[]
  const characters: CharSave[] = db
    .select()
    .from(runChar)
    .where(eq(runChar.runId, runId))
    .all()
    .map((c) => ({
      id: c.charId,
      energy: c.energy,
      stealBurden: c.stealBurden,
      shareGrace: c.shareGrace,
      deathWardSpent: !!c.deathWardSpent,
      params: { altruism: c.altruism, independence: c.independence, trust: c.trust },
      alive: !!c.alive,
      currentPlaceId: c.placeId,
      mood: {
        elation: c.moodElation,
        calm: c.moodCalm,
        warmth: c.moodWarmth,
        stress: c.moodStress,
      },
      antibodies: {
        achievement: c.antiAchievement,
        bond: c.antiBond,
        comfort: c.antiComfort,
        thrill: c.antiThrill,
      },
      currentWhisper: c.whisper ?? undefined,
      whisperIgnored: c.whisperIgnored ?? undefined,
      // 旧データ（relation_en 無し）は en 空→UI が日本語へフォールバック。JSON 化しないのでクラッシュしない。
      relationLabel: { ja: c.relation, en: c.relationEn ?? "" },
      episodicMemory: JSON.parse(c.episodicJson),
      diary: JSON.parse(c.diaryJson),
      soulCounters: c.soulCountersJson ? JSON.parse(c.soulCountersJson) : {}, // ココロ（kind→受領回数）
      frenzy: c.frenzyJson ? JSON.parse(c.frenzyJson) : undefined, // 荒ぶり（変身）状態（カイのみ。他は undefined）
    }));

  // 場所の枯れ具合 → PlaceSave[]
  const places: PlaceSave[] = db
    .select()
    .from(runPlace)
    .where(eq(runPlace.runId, runId))
    .all()
    .map((p) => ({ id: p.placeId, populace: { sei: p.sei, daku: p.daku } }));

  // 進行中イベント → WorldEvent[]
  const activeEvents: WorldEvent[] = db
    .select()
    .from(runEvent)
    .where(eq(runEvent.runId, runId))
    .orderBy(asc(runEvent.seq))
    .all()
    .map((e) => ({
      kind: e.kind as WorldEvent["kind"],
      name: e.name,
      icon: e.icon,
      remainingDays: e.remainingDays,
      totalDays: e.totalDays,
    }));

  const save: CampaignSave = {
    chronicle,
    day: run.lastDay,
    weather: run.weather as Weather,
    finished: !!run.finished,
    activeEvents,
    characters,
    places,
    pendingRegress: run.pendingRegressJson ? JSON.parse(run.pendingRegressJson) : null,
  };
  const ticksOfLoop = loadLoopTicks(runId, run.lastLoop);
  return { runId, save, loopTicks: ticksOfLoop };
}

/** 指定した回帰（loop）の完全 ticks を日付順に引く（LoopPage の1周再生用）。 */
export function loadLoopTicks(runId: number, loop: number): TickResult[] {
  return db
    .select({ resultJson: ticks.resultJson })
    .from(ticks)
    .where(and(eq(ticks.runId, runId), eq(ticks.loop, loop)))
    .orderBy(asc(ticks.day), asc(ticks.id))
    .all()
    .map((r) => JSON.parse(r.resultJson) as TickResult);
}

/** char_metrics の1行（キャラ別ページが必要とする薄い軌跡）。API 形状を保つため snake_case。 */
export interface CharTraceRow {
  loop: number;
  day: number;
  place_id: string; // 地名の英訳用（UI で place を解決。place_name は日本語フォールバック）
  place_name: string;
  diary: string; // 日本語（source of truth）
  diary_en: string; // 英語（未訳は空→UI が日本語フォールバック）
  diary_note: string | null; // 行動上書きの理由注記 "impulse" | "gift"
  died: number;
  altruism: number;
  stage: string;
  frenzy_active: number;
  became_frenzied: number;
}

/** 指定キャラの全周横断の軌跡を char_metrics から引く（重い TickResult は読まない）。 */
export function loadCharacterTrace(runId: number, charId: string): CharTraceRow[] {
  return db
    .select({
      loop: charMetrics.loop,
      day: charMetrics.day,
      place_id: charMetrics.placeId,
      place_name: charMetrics.placeName,
      diary: charMetrics.diary,
      diary_en: charMetrics.diaryEn,
      diary_note: charMetrics.diaryNote,
      died: charMetrics.died,
      altruism: charMetrics.altruism,
      stage: charMetrics.stage,
      frenzy_active: charMetrics.frenzyActive,
      became_frenzied: charMetrics.becameFrenzied,
    })
    .from(charMetrics)
    .where(and(eq(charMetrics.runId, runId), eq(charMetrics.charId, charId)))
    .orderBy(asc(charMetrics.loop), asc(charMetrics.day))
    .all();
}

// ============================================================
// 到達可能性の監査ログ
// ============================================================

/**
 * 到達可能性の監査ログを 1 tick ぶん記録する。
 * loop/day はその日に起きた tick の値（result.loop / result.day）を渡す。
 * progress は周頭でリセットされるため、毎 tick 残して時系列で最大到達を追えるようにする。
 * 同一 (run,loop,day) は消してから入れ直す（冪等＝tick リトライ等で重複させない）。
 */
export function saveSkillAudit(
  runId: number,
  audit: {
    loop: number;
    day: number;
    heroAltruism: number;
    peakAltruism: number;
    acquired: string[];
    progress: Record<string, number>;
    roster: string[];
  },
): void {
  db.transaction((tx) => {
    tx.delete(skillAudit)
      .where(
        and(eq(skillAudit.runId, runId), eq(skillAudit.loop, audit.loop), eq(skillAudit.day, audit.day)),
      )
      .run();
    tx.insert(skillAudit)
      .values({
        runId,
        loop: audit.loop,
        day: audit.day,
        ts: nowISO(),
        heroAltruism: audit.heroAltruism,
        peakAltruism: audit.peakAltruism,
        acquiredJson: JSON.stringify(audit.acquired),
        progressJson: JSON.stringify(audit.progress),
        rosterJson: JSON.stringify(audit.roster),
      })
      .run();
  });
}
