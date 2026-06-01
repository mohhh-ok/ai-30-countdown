// Drizzle スキーマ（SQLite）。テーブル/列名は従来の生SQLと完全一致させてある
// （scripts/audit-reachability.ts が独自接続で読むため、名前を変えない）。
//
// 設計方針は db.ts 冒頭のコメント参照（一系統・サロゲートPK・正規化・設定はコードが正）。
// スキーマの実体化は drizzle-kit push（npm run db:push）で行う＝手書き ALTER は廃止。
import { index, integer, primaryKey, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/** 1つの年代記（回帰をまたぐ1セッション）の現在状態。年代記スカラーを列に持つ。 */
export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  model: text("model").notNull(),
  finished: integer("finished").notNull().default(0),
  lastLoop: integer("last_loop").notNull().default(1), // 現在の周回
  lastDay: integer("last_day").notNull().default(0), // 現在の日
  weather: text("weather").notNull().default("normal"),
  protagonistId: text("protagonist_id").notNull().default("haru"),
  heroPeakAltruism: real("hero_peak_altruism").notNull().default(0),
});

/** スキル進捗（年代記）。1スキル1行。acquired=会得済み / progress=進捗カウンタ。 */
export const runSkill = sqliteTable(
  "run_skill",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    acquired: integer("acquired").notNull().default(0),
    progress: integer("progress").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.runId, t.skillId] })],
);

/** 恒久ロスター（解放済みキャラ）。1キャラ1行。 */
export const runRoster = sqliteTable(
  "run_roster",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    charId: text("char_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.charId] })],
);

/** キャラの可変状態（周の途中から再開するためのもの。不変設定はコードが正）。1キャラ1行で上書き。 */
export const runChar = sqliteTable(
  "run_char",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    charId: text("char_id").notNull(),
    energy: integer("energy").notNull(),
    // 禁忌「奪う」で積もる本人だけの恒久日次負荷の上乗せ（奪うほど重い）
    stealBurden: integer("steal_burden").notNull(),
    altruism: integer("altruism").notNull(),
    independence: integer("independence").notNull(),
    trust: integer("trust").notNull(),
    alive: integer("alive").notNull(),
    placeId: text("place_id").notNull(),
    moodElation: real("mood_elation").notNull(),
    moodCalm: real("mood_calm").notNull(),
    moodWarmth: real("mood_warmth").notNull(),
    moodStress: real("mood_stress").notNull(),
    antiAchievement: real("anti_achievement").notNull(),
    antiBond: real("anti_bond").notNull(),
    antiComfort: real("anti_comfort").notNull(),
    antiThrill: real("anti_thrill").notNull(),
    whisper: text("whisper"),
    whisperIgnored: integer("whisper_ignored"),
    relation: text("relation").notNull(),
    episodicJson: text("episodic_json").notNull(), // string[]（直近5件ほど）
    diaryJson: text("diary_json").notNull(), // string[]（現周の一行日記）
    debtsJson: text("debts_json"), // Record<creditorId, 負債量>（恩返し。null可）
  },
  (t) => [primaryKey({ columns: [t.runId, t.charId] })],
);

/** 場所の可変状態（民の霊力の枯れ具合だけ。地形・隣接・上限はコードが正）。1場所1行で上書き。 */
export const runPlace = sqliteTable(
  "run_place",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    placeId: text("place_id").notNull(),
    sei: integer("sei").notNull(),
    daku: integer("daku").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.placeId] })],
);

/** いま京に起きている災い/恵み（回帰でリセット）。保存のたびに全消し→入れ直し。 */
export const runEvent = sqliteTable(
  "run_event",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    remainingDays: integer("remaining_days").notNull(),
    totalDays: integer("total_days").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

/** 過去の周回の結末（年代記 history）。1周1行で上書き。 */
export const runLoopSummary = sqliteTable(
  "run_loop_summary",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull(),
    days: integer("days").notNull(),
    causeOfEnd: text("cause_of_end").notNull(),
    altruismReached: real("altruism_reached").notNull(),
    stageReached: text("stage_reached").notNull(),
    cleared: integer("cleared").notNull().default(0),
    acquiredSkillsJson: text("acquired_skills_json").notNull(), // SkillId[]
    metaHighlightsJson: text("meta_highlights_json"), // MetaEvent[]（無ければ null）
  },
  (t) => [primaryKey({ columns: [t.runId, t.loop] })],
);

/** 各日の TickResult を1日1行（表示・復元用）。 */
export const ticks = sqliteTable(
  "ticks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull(),
    day: integer("day").notNull(),
    weather: text("weather").notNull(),
    notable: text("notable").notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [unique().on(t.runId, t.loop, t.day), index("idx_ticks_run").on(t.runId, t.loop, t.day)],
);

/** 成長曲線・行動分析用に正規化した1日×1人の薄い行。 */
export const charMetrics = sqliteTable(
  "char_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull(),
    day: integer("day").notNull(),
    charId: text("char_id").notNull(),
    name: text("name").notNull(),
    action: text("action").notNull(),
    placeId: text("place_id").notNull(),
    placeName: text("place_name").notNull(),
    moved: integer("moved").notNull(),
    withPartner: integer("with_partner").notNull(),
    energyBefore: integer("energy_before").notNull(),
    energyAfter: integer("energy_after").notNull(),
    altruism: integer("altruism").notNull(),
    independence: integer("independence").notNull(),
    trust: integer("trust").notNull(),
    stage: text("stage").notNull(),
    diary: text("diary").notNull(),
    relation: text("relation").notNull(),
    deltaReason: text("delta_reason").notNull(),
    died: integer("died").notNull(),
  },
  (t) => [
    unique().on(t.runId, t.loop, t.day, t.charId),
    index("idx_metrics_char").on(t.runId, t.charId, t.loop, t.day),
  ],
);

/** その日の会話行。 */
export const dialogues = sqliteTable(
  "dialogues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull(),
    day: integer("day").notNull(),
    seq: integer("seq").notNull(),
    speakerId: text("speaker_id").notNull(),
    speakerName: text("speaker_name").notNull(),
    text: text("text").notNull(),
  },
  (t) => [unique().on(t.runId, t.loop, t.day, t.seq)],
);

/** LLM 呼び出し1回ぶんの所要時間（ボトルネック分析用に正規化）。 */
export const llmTimings = sqliteTable(
  "llm_timings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull().default(1),
    day: integer("day").notNull(),
    seq: integer("seq").notNull(), // その日の呼び出し順（0始まり）
    label: text("label").notNull(), // 種別/対象（decide:haru / dialogue / director / guardian）
    backend: text("backend").notNull(),
    model: text("model").notNull(),
    ms: integer("ms").notNull(), // 所要ミリ秒
    ok: integer("ok").notNull(), // 成功=1 / 失敗（リトライ試行）=0
    chars: integer("chars").notNull(), // 応答文字数
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    unique().on(t.runId, t.loop, t.day, t.seq),
    index("idx_timings_ref").on(t.runId, t.loop, t.day),
    index("idx_timings_label").on(t.label),
  ],
);

/** LLM 呼び出しの「発火ログ」。叩いた瞬間に1行(status='started')を残し、完了時に更新する。 */
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    startedAt: text("started_at").notNull(),
    label: text("label").notNull(),
    backend: text("backend").notNull(),
    model: text("model").notNull(),
    agentic: integer("agentic").notNull().default(0),
    status: text("status").notNull(), // 'started' | 'ok' | 'error'
    ms: integer("ms"),
    chars: integer("chars"),
    finishedAt: text("finished_at"),
    error: text("error"),
  },
  (t) => [index("idx_calls_status").on(t.status, t.id)],
);

/** スキル会得／キャラ解放の「到達可能性」監査ログ。毎 tick 1 行。 */
export const skillAudit = sqliteTable(
  "skill_audit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull(),
    day: integer("day").notNull(),
    ts: text("ts").notNull(),
    heroAltruism: real("hero_altruism").notNull(), // その日のハル利他（現在値）
    peakAltruism: real("peak_altruism").notNull(), // 通算ピーク利他（heroPeakAltruism）
    acquiredJson: text("acquired_json").notNull(), // 習得済みスキル id 配列
    progressJson: text("progress_json").notNull(), // 全スキルの進捗カウンタ
    rosterJson: text("roster_json").notNull(), // 解放済みキャラ id 配列
  },
  (t) => [
    unique().on(t.runId, t.loop, t.day),
    index("idx_skill_audit_run").on(t.runId, t.loop, t.day),
  ],
);
