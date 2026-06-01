// SQLite 永続化（bun:sqlite・依存ゼロ）。
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
// 主キーは全テーブル サロゲート id(AUTOINCREMENT)。回帰で day が周ごとに 1 に戻っても、
// 自然キーを PK にしないので衝突という概念自体が無い。同一 tick の冪等な再保存は
// UNIQUE(run_id, loop, day, …) ＋ INSERT OR REPLACE で担保する。
// 注意: INSERT OR REPLACE は UNIQUE 衝突時に「既存行を DELETE→INSERT」するため、再保存のたびに
//       ticks.id / char_metrics.id などのサロゲート id は変わる。これらは外部から FK 参照しない前提
//       （復元は (run_id) で引き ORDER BY loop,day するだけ）なので、id が変わっても影響しない。
import { Database } from "bun:sqlite";
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
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {
  /* 既存なら無視 */
}

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  -- 1つの年代記（回帰をまたぐ1セッション）の現在状態。年代記スカラーを列に持つ。
  -- 可変状態は run_char/run_place/run_skill/run_roster/run_event/run_loop_summary に正規化。
  -- 設定（地形・キャラ定義）はコードを正とし保存しない。表示ログは ticks に1日1行で積む。
  CREATE TABLE IF NOT EXISTS runs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at         TEXT NOT NULL,
    model              TEXT NOT NULL,
    finished           INTEGER NOT NULL DEFAULT 0,
    last_loop          INTEGER NOT NULL DEFAULT 1,  -- 現在の周回
    last_day           INTEGER NOT NULL DEFAULT 0,  -- 現在の日
    weather            TEXT NOT NULL DEFAULT 'normal',
    protagonist_id     TEXT NOT NULL DEFAULT 'haru',
    hero_peak_altruism REAL NOT NULL DEFAULT 0
  );

  -- スキル進捗（年代記）。1スキル1行。acquired=会得済み / progress=進捗カウンタ。
  CREATE TABLE IF NOT EXISTS run_skill (
    run_id   INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    acquired INTEGER NOT NULL DEFAULT 0,
    progress INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, skill_id)
  );

  -- 恒久ロスター（解放済みキャラ）。1キャラ1行。
  CREATE TABLE IF NOT EXISTS run_roster (
    run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    char_id TEXT NOT NULL,
    PRIMARY KEY (run_id, char_id)
  );

  -- キャラの可変状態（周の途中から再開するためのもの。不変設定はコードが正）。1キャラ1行で上書き。
  CREATE TABLE IF NOT EXISTS run_char (
    run_id          INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    char_id         TEXT NOT NULL,
    energy          INTEGER NOT NULL,
    altruism        INTEGER NOT NULL,
    independence    INTEGER NOT NULL,
    trust           INTEGER NOT NULL,
    alive           INTEGER NOT NULL,
    place_id        TEXT NOT NULL,
    mood_elation    REAL NOT NULL,
    mood_calm       REAL NOT NULL,
    mood_warmth     REAL NOT NULL,
    mood_stress     REAL NOT NULL,
    anti_achievement REAL NOT NULL,
    anti_bond       REAL NOT NULL,
    anti_comfort    REAL NOT NULL,
    anti_thrill     REAL NOT NULL,
    whisper         TEXT,
    whisper_ignored INTEGER,
    relation        TEXT NOT NULL,
    episodic_json   TEXT NOT NULL,  -- string[]（直近5件ほど）
    diary_json      TEXT NOT NULL,  -- string[]（現周の一行日記）
    debts_json      TEXT,           -- Record<creditorId, 負債量>（恩返しシステム。旧DB互換でnull可）
    PRIMARY KEY (run_id, char_id)
  );

  -- 場所の可変状態（民の霊力の枯れ具合だけ。地形・隣接・上限はコードが正）。1場所1行で上書き。
  CREATE TABLE IF NOT EXISTS run_place (
    run_id   INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    place_id TEXT NOT NULL,
    sei      INTEGER NOT NULL,
    daku     INTEGER NOT NULL,
    PRIMARY KEY (run_id, place_id)
  );

  -- いま京に起きている災い/恵み（回帰でリセット）。保存のたびに全消し→入れ直し。
  CREATE TABLE IF NOT EXISTS run_event (
    run_id         INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq            INTEGER NOT NULL,
    kind           TEXT NOT NULL,
    name           TEXT NOT NULL,
    icon           TEXT NOT NULL,
    remaining_days INTEGER NOT NULL,
    total_days     INTEGER NOT NULL,
    PRIMARY KEY (run_id, seq)
  );

  -- 過去の周回の結末（年代記 history）。1周1行で上書き。
  CREATE TABLE IF NOT EXISTS run_loop_summary (
    run_id               INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    loop                 INTEGER NOT NULL,
    days                 INTEGER NOT NULL,
    cause_of_end         TEXT NOT NULL,
    altruism_reached     REAL NOT NULL,
    stage_reached        TEXT NOT NULL,
    cleared              INTEGER NOT NULL DEFAULT 0,
    acquired_skills_json TEXT NOT NULL,  -- SkillId[]
    meta_highlights_json TEXT,           -- MetaEvent[]（無ければ null）
    PRIMARY KEY (run_id, loop)
  );

  CREATE TABLE IF NOT EXISTS ticks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    loop        INTEGER NOT NULL,
    day         INTEGER NOT NULL,
    weather     TEXT NOT NULL,
    notable     TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (run_id, loop, day)
  );

  CREATE INDEX IF NOT EXISTS idx_ticks_run ON ticks(run_id, loop, day);

  CREATE TABLE IF NOT EXISTS char_metrics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    loop          INTEGER NOT NULL,
    day           INTEGER NOT NULL,
    char_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    action        TEXT NOT NULL,
    place_id      TEXT NOT NULL,
    place_name    TEXT NOT NULL,
    moved         INTEGER NOT NULL,
    with_partner  INTEGER NOT NULL,
    energy_before INTEGER NOT NULL,
    energy_after  INTEGER NOT NULL,
    altruism      INTEGER NOT NULL,
    independence  INTEGER NOT NULL,
    trust         INTEGER NOT NULL,
    stage         TEXT NOT NULL,
    diary         TEXT NOT NULL,
    relation      TEXT NOT NULL,
    delta_reason  TEXT NOT NULL,
    died          INTEGER NOT NULL,
    UNIQUE (run_id, loop, day, char_id)
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_char ON char_metrics(run_id, char_id, loop, day);

  CREATE TABLE IF NOT EXISTS dialogues (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    loop         INTEGER NOT NULL,
    day          INTEGER NOT NULL,
    seq          INTEGER NOT NULL,
    speaker_id   TEXT NOT NULL,
    speaker_name TEXT NOT NULL,
    text         TEXT NOT NULL,
    UNIQUE (run_id, loop, day, seq)
  );

  -- LLM 呼び出し1回ぶんの所要時間（ボトルネック分析用に正規化）。
  -- 同一 (run_id, loop, day) は保存し直すたびに delete→insert で入れ替える（冪等）。
  CREATE TABLE IF NOT EXISTS llm_timings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    loop       INTEGER NOT NULL DEFAULT 1,
    day        INTEGER NOT NULL,
    seq        INTEGER NOT NULL,         -- その日の呼び出し順（0始まり）
    label      TEXT NOT NULL,            -- 種別/対象（decide:haru / dialogue / director / guardian）
    backend    TEXT NOT NULL,
    model      TEXT NOT NULL,
    ms         INTEGER NOT NULL,         -- 所要ミリ秒
    ok         INTEGER NOT NULL,         -- 成功=1 / 失敗（リトライ試行）=0
    chars      INTEGER NOT NULL,         -- 応答文字数
    created_at TEXT NOT NULL,
    UNIQUE (run_id, loop, day, seq)
  );

  CREATE INDEX IF NOT EXISTS idx_timings_ref ON llm_timings(run_id, loop, day);
  CREATE INDEX IF NOT EXISTS idx_timings_label ON llm_timings(label);

  -- LLM 呼び出しの「発火ログ」。叩いた瞬間に1行(status='started')を残し、完了時に更新する。
  -- tick の集計(llm_timings)とは別系統で、「いま実際に叩いているか／どこで詰まっているか」を
  -- 進行中でも DB から確認できる。status='started' のまま残る行 = 未完了（ハングや強制終了の痕跡）。
  CREATE TABLE IF NOT EXISTS llm_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    label       TEXT NOT NULL,
    backend     TEXT NOT NULL,
    model       TEXT NOT NULL,
    agentic     INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL,            -- 'started' | 'ok' | 'error'
    ms          INTEGER,
    chars       INTEGER,
    finished_at TEXT,
    error       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_calls_status ON llm_calls(status, id);

  -- スキル会得／キャラ解放の「到達可能性」監査ログ。毎 tick 1 行、その時点の
  -- スキル進捗・習得・ハル利他・解放ロスターのスナップを残す（run の時系列）。
  -- run_skill 等の現在状態は「今の値」しか持たないため、loop スコープのスキルは周頭でリセットされ
  -- 「毎周どこまで届いたか」が追えない。この表に毎 tick 残すことで、
  --   ・通算何周回っても progress が伸びないスキル（＝実質会得不能）
  --   ・条件に永久に届かないキャラ
  -- を scripts/audit-reachability.ts が時系列で炙り出せる。1 行 INSERT は LLM 待ちに対し誤差。
  -- UNIQUE(run_id, loop, day) ＋ INSERT OR REPLACE なので「同一周・同日」を二度記録すると
  -- 後者で上書きする（冪等＝tick リトライ等で重複させない）。通常は 1 tick = 1 行。
  CREATE TABLE IF NOT EXISTS skill_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    loop          INTEGER NOT NULL,
    day           INTEGER NOT NULL,
    ts            TEXT NOT NULL,
    hero_altruism REAL NOT NULL,        -- その日のハル利他（現在値）
    peak_altruism REAL NOT NULL,        -- 通算ピーク利他（heroPeakAltruism）
    acquired_json TEXT NOT NULL,        -- 習得済みスキル id 配列
    progress_json TEXT NOT NULL,        -- 全スキルの進捗カウンタ（measure の痕跡）
    roster_json   TEXT NOT NULL,        -- 解放済みキャラ id 配列
    UNIQUE (run_id, loop, day)
  );

  CREATE INDEX IF NOT EXISTS idx_skill_audit_run ON skill_audit(run_id, loop, day);
`);

// --- マイグレーション（既存DB向け。CREATE TABLE IF NOT EXISTS は列追加を反映しないので、
//     列を足したら必ずここで ALTER も通す。PRAGMA でガードして冪等にする）---
{
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(run_char)")
    .all()
    .map((r) => r.name);
  if (!cols.includes("debts_json")) {
    db.exec("ALTER TABLE run_char ADD COLUMN debts_json TEXT"); // 恩の負債（恩返しシステム）
  }
}

// --- prepared statements ---
const insertRun = db.query<
  { id: number },
  [string, string, number, number, string, string, number]
>(
  `INSERT INTO runs (started_at, model, last_loop, last_day, weather, protagonist_id, hero_peak_altruism)
   VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
);
const updateRun = db.query(
  `UPDATE runs SET finished = ?, last_loop = ?, last_day = ?, weather = ?, hero_peak_altruism = ? WHERE id = ?`,
);
// 年代記＝正規化状態（保存のたびに upsert / 該当 run を全消し→入れ直し）
const clearSkills = db.query(`DELETE FROM run_skill WHERE run_id = ?`);
const upsertSkill = db.query(
  `INSERT OR REPLACE INTO run_skill (run_id, skill_id, acquired, progress) VALUES (?, ?, ?, ?)`,
);
const clearRoster = db.query(`DELETE FROM run_roster WHERE run_id = ?`);
const insertRosterRow = db.query(
  `INSERT OR REPLACE INTO run_roster (run_id, char_id) VALUES (?, ?)`,
);
const upsertChar = db.query(
  `INSERT OR REPLACE INTO run_char
   (run_id, char_id, energy, altruism, independence, trust, alive, place_id,
    mood_elation, mood_calm, mood_warmth, mood_stress,
    anti_achievement, anti_bond, anti_comfort, anti_thrill,
    whisper, whisper_ignored, relation, episodic_json, diary_json, debts_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
const upsertPlace = db.query(
  `INSERT OR REPLACE INTO run_place (run_id, place_id, sei, daku) VALUES (?, ?, ?, ?)`,
);
const clearEvents = db.query(`DELETE FROM run_event WHERE run_id = ?`);
const insertEvent = db.query(
  `INSERT INTO run_event (run_id, seq, kind, name, icon, remaining_days, total_days)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const upsertLoopSummary = db.query(
  `INSERT OR REPLACE INTO run_loop_summary
   (run_id, loop, days, cause_of_end, altruism_reached, stage_reached, cleared,
    acquired_skills_json, meta_highlights_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
// 復元用 SELECT
const selectSkills = db.query<
  { skill_id: string; acquired: number; progress: number },
  [number]
>(`SELECT skill_id, acquired, progress FROM run_skill WHERE run_id = ?`);
const selectRoster = db.query<{ char_id: string }, [number]>(
  `SELECT char_id FROM run_roster WHERE run_id = ?`,
);
const selectChars = db.query<RunCharRow, [number]>(
  `SELECT * FROM run_char WHERE run_id = ?`,
);
const selectPlaces = db.query<{ place_id: string; sei: number; daku: number }, [number]>(
  `SELECT place_id, sei, daku FROM run_place WHERE run_id = ?`,
);
const selectEvents = db.query<RunEventRow, [number]>(
  `SELECT kind, name, icon, remaining_days, total_days FROM run_event WHERE run_id = ? ORDER BY seq ASC`,
);
const selectLoopSummaries = db.query<RunLoopSummaryRow, [number]>(
  `SELECT loop, days, cause_of_end, altruism_reached, stage_reached, cleared,
          acquired_skills_json, meta_highlights_json
   FROM run_loop_summary WHERE run_id = ? ORDER BY loop ASC`,
);
const insertTick = db.query(
  `INSERT OR REPLACE INTO ticks (run_id, loop, day, weather, notable, result_json, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const insertMetric = db.query(
  `INSERT OR REPLACE INTO char_metrics
   (run_id, loop, day, char_id, name, action, place_id, place_name, moved, with_partner,
    energy_before, energy_after, altruism, independence, trust, stage, diary, relation, delta_reason, died)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
const deleteDialogue = db.query(
  `DELETE FROM dialogues WHERE run_id = ? AND loop = ? AND day = ?`,
);
const insertDialogue = db.query(
  `INSERT INTO dialogues (run_id, loop, day, seq, speaker_id, speaker_name, text)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const latestRun = db.query<RunRow, []>(
  `SELECT * FROM runs ORDER BY id DESC LIMIT 1`,
);
// 過去の回帰を見るときだけ、その周の完全 ticks を引く（起動時に全件は読まない）。
const loopTicks = db.query<{ result_json: string }, [number, number]>(
  `SELECT result_json FROM ticks WHERE run_id = ? AND loop = ? ORDER BY day ASC, id ASC`,
);
// キャラ別ページ用の「全周横断の薄い軌跡」。重い TickResult JSON ではなく char_metrics を引く。
const charTrace = db.query<CharTraceRow, [number, string]>(
  `SELECT loop, day, place_name, diary, died, altruism, stage
   FROM char_metrics WHERE run_id = ? AND char_id = ? ORDER BY loop ASC, day ASC`,
);
const deleteTimings = db.query(
  `DELETE FROM llm_timings WHERE run_id = ? AND loop = ? AND day = ?`,
);
const insertTiming = db.query(
  `INSERT INTO llm_timings
   (run_id, loop, day, seq, label, backend, model, ms, ok, chars, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
);
const insertCallStart = db.query<{ id: number }, [string, string, string, string, number]>(
  `INSERT INTO llm_calls (started_at, label, backend, model, agentic, status)
   VALUES (?, ?, ?, ?, ?, 'started') RETURNING id`,
);
const updateCallEnd = db.query(
  `UPDATE llm_calls SET status = ?, ms = ?, chars = ?, finished_at = ?, error = ? WHERE id = ?`,
);

interface RunRow {
  id: number;
  started_at: string;
  model: string;
  finished: number;
  last_loop: number;
  last_day: number;
  weather: string;
  protagonist_id: string;
  hero_peak_altruism: number;
}

interface RunCharRow {
  run_id: number;
  char_id: string;
  energy: number;
  altruism: number;
  independence: number;
  trust: number;
  alive: number;
  place_id: string;
  mood_elation: number;
  mood_calm: number;
  mood_warmth: number;
  mood_stress: number;
  anti_achievement: number;
  anti_bond: number;
  anti_comfort: number;
  anti_thrill: number;
  whisper: string | null;
  whisper_ignored: number | null;
  relation: string;
  episodic_json: string;
  diary_json: string;
  debts_json: string | null;
}

interface RunEventRow {
  kind: string;
  name: string;
  icon: string;
  remaining_days: number;
  total_days: number;
}

interface RunLoopSummaryRow {
  loop: number;
  days: number;
  cause_of_end: string;
  altruism_reached: number;
  stage_reached: string;
  cleared: number;
  acquired_skills_json: string;
  meta_highlights_json: string | null;
}

/** 現在時刻（テスト容易性のため引数で受ける） */
function nowISO(): string {
  return new Date().toISOString();
}

/** セーブ状態を正規化テーブルへ書き込む（run 行は別途。ここは状態テーブルのみ）。1トランザクション。 */
function writeState(runId: number, save: CampaignSave): void {
  const tx = db.transaction(() => {
    // スキル進捗（全消し→入れ直し。会得フラグ＋進捗カウンタ）
    clearSkills.run(runId);
    const skillIds = new Set<string>([
      ...Object.keys(save.chronicle.skills.progress),
      ...save.chronicle.skills.acquired,
    ]);
    const acquiredSet = new Set(save.chronicle.skills.acquired);
    for (const id of skillIds) {
      upsertSkill.run(
        runId,
        id,
        acquiredSet.has(id) ? 1 : 0,
        save.chronicle.skills.progress[id] ?? 0,
      );
    }
    // ロスター
    clearRoster.run(runId);
    for (const cid of save.chronicle.roster) insertRosterRow.run(runId, cid);
    // キャラ可変状態
    for (const c of save.characters) {
      upsertChar.run(
        runId,
        c.id,
        c.energy,
        c.params.altruism,
        c.params.independence,
        c.params.trust,
        c.alive ? 1 : 0,
        c.currentPlaceId,
        c.mood.elation,
        c.mood.calm,
        c.mood.warmth,
        c.mood.stress,
        c.antibodies.achievement,
        c.antibodies.bond,
        c.antibodies.comfort,
        c.antibodies.thrill,
        c.currentWhisper ?? null,
        c.whisperIgnored ?? null,
        c.relationLabel,
        JSON.stringify(c.episodicMemory),
        JSON.stringify(c.diary),
        c.debts ? JSON.stringify(c.debts) : null, // 恩の負債（無ければ null）
      );
    }
    // 場所の枯れ具合
    for (const p of save.places) upsertPlace.run(runId, p.id, p.populace.sei, p.populace.daku);
    // 進行中イベント（全消し→入れ直し）
    clearEvents.run(runId);
    save.activeEvents.forEach((e, i) =>
      insertEvent.run(runId, i, e.kind, e.name, e.icon, e.remainingDays, e.totalDays),
    );
    // 周回履歴（1周1行 upsert）
    for (const h of save.chronicle.history) {
      upsertLoopSummary.run(
        runId,
        h.loop,
        h.days,
        h.causeOfEnd,
        h.altruismReached,
        h.stageReached,
        h.cleared ? 1 : 0,
        JSON.stringify(h.acquiredSkills),
        h.metaHighlights ? JSON.stringify(h.metaHighlights) : null,
      );
    }
  });
  tx();
}

/** 新しい run を作成して id を返す（年代記スカラーを runs に、可変状態を各テーブルに保存）。 */
export function createRun(save: CampaignSave, model: string): number {
  const row = insertRun.get(
    nowISO(),
    model,
    save.chronicle.loop,
    save.day,
    save.weather,
    save.chronicle.protagonistId,
    save.chronicle.heroPeakAltruism,
  );
  const runId = row!.id;
  writeState(runId, save);
  return runId;
}

/** run の現在状態を更新（年代記スカラー＋正規化された可変状態）。 */
export function saveRunState(runId: number, save: CampaignSave): void {
  updateRun.run(
    save.finished ? 1 : 0,
    save.chronicle.loop,
    save.day,
    save.weather,
    save.chronicle.heroPeakAltruism,
    runId,
  );
  writeState(runId, save);
}

/** 1ティックの結果を ticks と char_metrics・dialogues に保存（loop は result.loop） */
export function saveTick(runId: number, result: TickResult): void {
  const loop = result.loop ?? 1;
  const tx = db.transaction(() => {
    insertTick.run(
      runId,
      loop,
      result.day,
      result.weather,
      result.notable,
      JSON.stringify(result),
      nowISO(),
    );
    for (const c of result.characters) {
      insertMetric.run(
        runId,
        loop,
        result.day,
        c.id,
        c.name,
        c.action,
        c.placeId,
        c.placeName,
        c.moved ? 1 : 0,
        c.withPartner ? 1 : 0,
        c.energyBefore,
        c.energyAfter,
        c.paramsAfter.altruism,
        c.paramsAfter.independence,
        c.paramsAfter.trust,
        c.stageAfter,
        c.diary,
        c.relationLabel,
        c.deltaReason,
        c.died ? 1 : 0,
      );
    }
    // 会話（あれば）。同一 (run,loop,day) を消してから入れ直す（再保存で seq の取りこぼしを残さない）
    deleteDialogue.run(runId, loop, result.day);
    result.dialogue?.forEach((line, i) => {
      insertDialogue.run(
        runId,
        loop,
        result.day,
        i,
        line.speakerId,
        line.speakerName,
        line.text,
      );
    });
  });
  tx();
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
  const tx = db.transaction(() => {
    deleteTimings.run(runId, loop, day);
    (timings ?? []).forEach((t, i) => {
      insertTiming.run(
        runId,
        loop,
        day,
        i,
        t.label,
        t.backend,
        t.model,
        t.ms,
        t.ok ? 1 : 0,
        t.chars,
        nowISO(),
      );
    });
  });
  tx();
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
    const row = insertCallStart.get(nowISO(), label, backend, model, agentic ? 1 : 0);
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
    updateCallEnd.run(status, ms, chars, nowISO(), error ?? null, id);
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
  const run = latestRun.get();
  if (!run) return null;
  const runId = run.id;

  // スキル進捗 → SkillProfile
  const skillRows = selectSkills.all(runId);
  const skills: SkillProfile = {
    acquired: skillRows.filter((r) => r.acquired).map((r) => r.skill_id),
    progress: Object.fromEntries(skillRows.map((r) => [r.skill_id, r.progress])),
  };
  // 履歴 → LoopSummary[]
  const history: LoopSummary[] = selectLoopSummaries.all(runId).map((h) => ({
    loop: h.loop,
    days: h.days,
    causeOfEnd: h.cause_of_end,
    altruismReached: h.altruism_reached,
    stageReached: h.stage_reached as LoopSummary["stageReached"],
    acquiredSkills: JSON.parse(h.acquired_skills_json),
    cleared: h.cleared ? true : undefined,
    metaHighlights: h.meta_highlights_json ? JSON.parse(h.meta_highlights_json) : undefined,
  }));
  const chronicle: Chronicle = {
    loop: run.last_loop,
    protagonistId: run.protagonist_id,
    skills,
    roster: selectRoster.all(runId).map((r) => r.char_id),
    heroPeakAltruism: run.hero_peak_altruism,
    history,
  };

  // キャラ可変状態 → CharSave[]
  const characters: CharSave[] = selectChars.all(runId).map((c) => ({
    id: c.char_id,
    energy: c.energy,
    params: { altruism: c.altruism, independence: c.independence, trust: c.trust },
    alive: !!c.alive,
    currentPlaceId: c.place_id,
    mood: {
      elation: c.mood_elation,
      calm: c.mood_calm,
      warmth: c.mood_warmth,
      stress: c.mood_stress,
    },
    antibodies: {
      achievement: c.anti_achievement,
      bond: c.anti_bond,
      comfort: c.anti_comfort,
      thrill: c.anti_thrill,
    },
    currentWhisper: c.whisper ?? undefined,
    whisperIgnored: c.whisper_ignored ?? undefined,
    relationLabel: c.relation,
    episodicMemory: JSON.parse(c.episodic_json),
    diary: JSON.parse(c.diary_json),
    debts: c.debts_json ? JSON.parse(c.debts_json) : undefined, // 旧DBは null → undefined
  }));
  // 場所の枯れ具合 → PlaceSave[]
  const places: PlaceSave[] = selectPlaces.all(runId).map((p) => ({
    id: p.place_id,
    populace: { sei: p.sei, daku: p.daku },
  }));
  // 進行中イベント → WorldEvent[]
  const activeEvents: WorldEvent[] = selectEvents.all(runId).map((e) => ({
    kind: e.kind as WorldEvent["kind"],
    name: e.name,
    icon: e.icon,
    remainingDays: e.remaining_days,
    totalDays: e.total_days,
  }));

  const save: CampaignSave = {
    chronicle,
    day: run.last_day,
    weather: run.weather as Weather,
    finished: !!run.finished,
    activeEvents,
    characters,
    places,
  };
  const loopTicks = loadLoopTicks(runId, run.last_loop);
  return { runId, save, loopTicks };
}

/** 指定した回帰（loop）の完全 ticks を日付順に引く（LoopPage の1周再生用）。 */
export function loadLoopTicks(runId: number, loop: number): TickResult[] {
  return loopTicks
    .all(runId, loop)
    .map((r) => JSON.parse(r.result_json) as TickResult);
}

/** char_metrics の1行（キャラ別ページが必要とする薄い軌跡）。 */
export interface CharTraceRow {
  loop: number;
  day: number;
  place_name: string;
  diary: string;
  died: number;
  altruism: number;
  stage: string;
}

/** 指定キャラの全周横断の軌跡を char_metrics から引く（重い TickResult は読まない）。 */
export function loadCharacterTrace(runId: number, charId: string): CharTraceRow[] {
  return charTrace.all(runId, charId);
}

// ============================================================
// 到達可能性の監査ログ
// ============================================================
const insertSkillAudit = db.query(
  `INSERT OR REPLACE INTO skill_audit
   (run_id, loop, day, ts, hero_altruism, peak_altruism, acquired_json, progress_json, roster_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

/**
 * 到達可能性の監査ログを 1 tick ぶん記録する。
 * loop/day はその日に起きた tick の値（result.loop / result.day）を渡す。
 * progress は周頭でリセットされるため、毎 tick 残して時系列で最大到達を追えるようにする。
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
  insertSkillAudit.run(
    runId,
    audit.loop,
    audit.day,
    nowISO(),
    audit.heroAltruism,
    audit.peakAltruism,
    JSON.stringify(audit.acquired),
    JSON.stringify(audit.progress),
    JSON.stringify(audit.roster),
  );
}

export { db };
