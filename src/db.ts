// SQLite 永続化（bun:sqlite・依存ゼロ）。
// - runs:         1回のシミュレーション（リセットごとに新 run）。state スナップショットも持つ。
// - ticks:        各日の TickResult を丸ごと JSON 保存（表示・復元用）。
// - char_metrics: 成長曲線・行動分析用に正規化した1日×1人の薄い行。
import { Database } from "bun:sqlite";
import type { LlmCallTiming, TickResult, Weather, WorldState } from "./domain/types.ts";
import type { CampaignSnapshot } from "./domain/campaign.ts";

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
  CREATE TABLE IF NOT EXISTS runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL,
    model           TEXT NOT NULL,
    finished        INTEGER NOT NULL DEFAULT 0,
    last_day        INTEGER NOT NULL DEFAULT 0,
    state_json      TEXT NOT NULL,
    weather_history TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS ticks (
    run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    day         INTEGER NOT NULL,
    weather     TEXT NOT NULL,
    notable     TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (run_id, day)
  );

  CREATE TABLE IF NOT EXISTS char_metrics (
    run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
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
    PRIMARY KEY (run_id, day, char_id)
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_char ON char_metrics(run_id, char_id, day);

  CREATE TABLE IF NOT EXISTS dialogues (
    run_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    day          INTEGER NOT NULL,
    seq          INTEGER NOT NULL,
    speaker_id   TEXT NOT NULL,
    speaker_name TEXT NOT NULL,
    text         TEXT NOT NULL,
    PRIMARY KEY (run_id, day, seq)
  );

  -- 回帰（キャンペーン）の永続化。1 campaign = 回帰をまたぐ1つの年代記。
  -- 周回ごとに day が 1 に戻るため正規化テーブルでは PK が衝突する。
  -- そこで年代記まるごと（chronicle/world/天候/現周ログ）と表示用ログを JSON で保存する。
  CREATE TABLE IF NOT EXISTS campaigns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at    TEXT NOT NULL,
    model         TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    log_json      TEXT NOT NULL DEFAULT '[]'
  );

  -- LLM 呼び出し1回ぶんの所要時間（ボトルネック分析用に正規化）。
  -- scope/ref_id で run か campaign のどちらに属すかを区別する（PK を共有しない別系統のため）。
  -- 同一 (scope, ref_id, loop, day) は保存し直しのたびに delete→insert で入れ替える（冪等）。
  CREATE TABLE IF NOT EXISTS llm_timings (
    scope      TEXT NOT NULL,            -- 'run' | 'campaign'
    ref_id     INTEGER NOT NULL,         -- run_id か campaign_id
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
    PRIMARY KEY (scope, ref_id, loop, day, seq)
  );

  CREATE INDEX IF NOT EXISTS idx_timings_ref ON llm_timings(scope, ref_id, day);
  CREATE INDEX IF NOT EXISTS idx_timings_label ON llm_timings(label);
`);

// --- prepared statements ---
const insertRun = db.query<{ id: number }, [string, string, string]>(
  `INSERT INTO runs (started_at, model, state_json) VALUES (?, ?, ?) RETURNING id`,
);
const updateRun = db.query(
  `UPDATE runs SET finished = ?, last_day = ?, state_json = ?, weather_history = ? WHERE id = ?`,
);
const insertTick = db.query(
  `INSERT OR REPLACE INTO ticks (run_id, day, weather, notable, result_json, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const insertMetric = db.query(
  `INSERT OR REPLACE INTO char_metrics
   (run_id, day, char_id, name, action, place_id, place_name, moved, with_partner,
    energy_before, energy_after, altruism, independence, trust, stage, diary, relation, delta_reason, died)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
const deleteDialogue = db.query(
  `DELETE FROM dialogues WHERE run_id = ? AND day = ?`,
);
const insertDialogue = db.query(
  `INSERT INTO dialogues (run_id, day, seq, speaker_id, speaker_name, text)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const latestRun = db.query<RunRow, []>(
  `SELECT * FROM runs ORDER BY id DESC LIMIT 1`,
);
const ticksForRun = db.query<{ result_json: string }, [number]>(
  `SELECT result_json FROM ticks WHERE run_id = ? ORDER BY day ASC`,
);
const deleteTimings = db.query(
  `DELETE FROM llm_timings WHERE scope = ? AND ref_id = ? AND loop = ? AND day = ?`,
);
const insertTiming = db.query(
  `INSERT INTO llm_timings
   (scope, ref_id, loop, day, seq, label, backend, model, ms, ok, chars, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
);

interface RunRow {
  id: number;
  started_at: string;
  model: string;
  finished: number;
  last_day: number;
  state_json: string;
  weather_history: string;
}

/** 現在時刻（テスト容易性のため引数で受ける） */
function nowISO(): string {
  return new Date().toISOString();
}

/** 新しい run を作成して id を返す */
export function createRun(state: WorldState, model: string): number {
  const row = insertRun.get(nowISO(), model, JSON.stringify(state));
  return row!.id;
}

/** run のスナップショット（state・天候履歴・進捗）を更新 */
export function saveRunSnapshot(
  runId: number,
  state: WorldState,
  weatherHistory: Weather[],
): void {
  updateRun.run(
    state.finished ? 1 : 0,
    state.day,
    JSON.stringify(state),
    JSON.stringify(weatherHistory),
    runId,
  );
}

/** 1ティックの結果を ticks と char_metrics に保存 */
export function saveTick(runId: number, result: TickResult): void {
  const tx = db.transaction(() => {
    insertTick.run(
      runId,
      result.day,
      result.weather,
      result.notable,
      JSON.stringify(result),
      nowISO(),
    );
    for (const c of result.characters) {
      insertMetric.run(
        runId,
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
    // 会話（あれば）
    deleteDialogue.run(runId, result.day);
    result.dialogue?.forEach((line, i) => {
      insertDialogue.run(
        runId,
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
 * 同一 (scope, ref_id, loop, day) は一度消してから入れ直す（再保存しても重複しない）。
 */
export function saveLlmTimings(
  scope: "run" | "campaign",
  refId: number,
  loop: number,
  day: number,
  timings: LlmCallTiming[] | undefined,
): void {
  const tx = db.transaction(() => {
    deleteTimings.run(scope, refId, loop, day);
    (timings ?? []).forEach((t, i) => {
      insertTiming.run(
        scope,
        refId,
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

/** 最新 run を復元（state・天候履歴・tickログ）。無ければ null。 */
export function loadLatestRun(): {
  runId: number;
  state: WorldState;
  weatherHistory: Weather[];
  log: TickResult[];
} | null {
  const run = latestRun.get();
  if (!run) return null;
  const state = JSON.parse(run.state_json) as WorldState;
  const weatherHistory = JSON.parse(run.weather_history) as Weather[];
  const log = ticksForRun
    .all(run.id)
    .map((r) => JSON.parse(r.result_json) as TickResult);
  // 旧スキーマで保存された state に新フィールドが無い場合を補完（後方互換）
  for (const c of state.characters) normalizeCharacter(c);
  for (const p of state.places) normalizePlace(p);
  if (!state.activeEvents) state.activeEvents = [];
  return { runId: run.id, state, weatherHistory, log };
}

/** 旧データに欠けている報酬・気分・執着・異能フィールドをデフォルトで補完する */
function normalizeCharacter(c: any): void {
  if (typeof c.satiety !== "number") c.satiety = 40;
  if (!c.sensitization)
    c.sensitization = { achievement: 0.3, bond: 0.3, comfort: 0.3, thrill: 0.4 };
  if (typeof c.clearance !== "number") c.clearance = 0.15;
  if (typeof c.lonelinessSensitivity !== "number") c.lonelinessSensitivity = 5;
  if (!c.antibodies)
    c.antibodies = { achievement: 0, bond: 0, comfort: 0, thrill: 0 };
  if (!c.mood) c.mood = { elation: 0, calm: 0, warmth: 0, stress: 0 };
  if (typeof c.talent !== "string") c.talent = "none";
}

/** 旧データに欠けている民の霊力プール（清/濁）を、その地の実りからの推定値で補完する */
function normalizePlace(p: any): void {
  const cap = p.forage?.normal ?? 12;
  if (!p.populace) p.populace = { sei: cap * 3, daku: Math.round(cap * 1.5) };
  if (!p.populaceMax) p.populaceMax = { sei: p.populace.sei, daku: p.populace.daku };
  if (!p.regen) p.regen = { sei: Math.max(2, Math.round(cap / 2)), daku: 3 };
}

// ============================================================
// 回帰（キャンペーン）の永続化
// ============================================================
const insertCampaign = db.query<{ id: number }, [string, string, string]>(
  `INSERT INTO campaigns (started_at, model, snapshot_json) VALUES (?, ?, ?) RETURNING id`,
);
const updateCampaign = db.query(
  `UPDATE campaigns SET snapshot_json = ?, log_json = ? WHERE id = ?`,
);
const latestCampaign = db.query<
  { id: number; snapshot_json: string; log_json: string },
  []
>(`SELECT id, snapshot_json, log_json FROM campaigns ORDER BY id DESC LIMIT 1`);

/** 新しいキャンペーンを作成して id を返す */
export function createCampaign(snapshot: CampaignSnapshot, model: string): number {
  const row = insertCampaign.get(nowISO(), model, JSON.stringify(snapshot));
  return row!.id;
}

/** キャンペーンのスナップショットと表示用ログを保存 */
export function saveCampaign(
  id: number,
  snapshot: CampaignSnapshot,
  log: TickResult[],
): void {
  updateCampaign.run(JSON.stringify(snapshot), JSON.stringify(log), id);
}

/** 最新キャンペーンを復元。無ければ null。 */
export function loadLatestCampaign(): {
  id: number;
  snapshot: CampaignSnapshot;
  log: TickResult[];
} | null {
  const row = latestCampaign.get();
  if (!row) return null;
  const snapshot = JSON.parse(row.snapshot_json) as CampaignSnapshot;
  const log = JSON.parse(row.log_json) as TickResult[];
  // 旧スキーマで保存された world に新フィールドが無い場合を補完（後方互換）
  for (const c of snapshot.world.characters) normalizeCharacter(c);
  for (const p of snapshot.world.places) normalizePlace(p);
  if (!snapshot.world.activeEvents) snapshot.world.activeEvents = [];
  return { id: row.id, snapshot, log };
}

export { db };
