// SQLite 永続化（bun:sqlite・依存ゼロ）。
//
// 設計方針（一系統・サロゲートキー）:
// - runs:         1つの年代記（回帰をまたぐ1セッション）。復元用スナップショット(JSON)を1本持つ。
//                 CLI(sim.ts) と Web(server.ts) の双方がこの同じスキーマに保存する（テーブルは一系統）。
//                 開発と本番は DB_PATH でファイルを分けるだけ（スキーマは共通）。
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
import type { LlmCallTiming, TickResult, Weather, WorldState } from "./domain/types.ts";
import type { CampaignSnapshot } from "./domain/campaign.ts";
import { createInitialCharacters } from "./domain/characters.ts";

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
  -- 1つの年代記（回帰をまたぐ1セッション）。復元に必要な現在状態を snapshot_json に1本持つ。
  -- snapshot は「現在の世界＋年代記＋現周ログ」だけ（現周ログは回帰でリセットされるので肥大しない）。
  -- 全周の表示ログは ticks 側に1日1行で積むので、ここに巨大ログを持たせない。
  CREATE TABLE IF NOT EXISTS runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at    TEXT NOT NULL,
    model         TEXT NOT NULL,
    finished      INTEGER NOT NULL DEFAULT 0,
    last_loop     INTEGER NOT NULL DEFAULT 1,
    last_day      INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL
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
  -- snapshot_json は「今の値」しか持たないため、loop スコープのスキルは周頭でリセットされ
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

// --- prepared statements ---
const insertRun = db.query<{ id: number }, [string, string, number, number, string]>(
  `INSERT INTO runs (started_at, model, last_loop, last_day, snapshot_json)
   VALUES (?, ?, ?, ?, ?) RETURNING id`,
);
const updateRun = db.query(
  `UPDATE runs SET finished = ?, last_loop = ?, last_day = ?, snapshot_json = ? WHERE id = ?`,
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
const ticksForRun = db.query<{ result_json: string }, [number]>(
  `SELECT result_json FROM ticks WHERE run_id = ? ORDER BY loop ASC, day ASC, id ASC`,
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
  snapshot_json: string;
}

/** 現在時刻（テスト容易性のため引数で受ける） */
function nowISO(): string {
  return new Date().toISOString();
}

/** 新しい run を作成して id を返す（復元用スナップショットを1本保存） */
export function createRun(snapshot: CampaignSnapshot, model: string): number {
  const row = insertRun.get(
    nowISO(),
    model,
    snapshot.chronicle.loop,
    snapshot.world.day,
    JSON.stringify(snapshot),
  );
  return row!.id;
}

/** run の復元用スナップショット（年代記＋世界＋現周ログ）と進捗を更新 */
export function saveRunSnapshot(runId: number, snapshot: CampaignSnapshot): void {
  updateRun.run(
    snapshot.world.finished ? 1 : 0,
    snapshot.chronicle.loop,
    snapshot.world.day,
    JSON.stringify(snapshot),
    runId,
  );
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

/** 最新 run を復元（スナップショット＋全周の表示ログ）。無ければ null。 */
export function loadLatestRun(): {
  runId: number;
  snapshot: CampaignSnapshot;
  log: TickResult[];
} | null {
  const run = latestRun.get();
  if (!run) return null;
  const snapshot = JSON.parse(run.snapshot_json) as CampaignSnapshot;
  const log = ticksForRun
    .all(run.id)
    .map((r) => JSON.parse(r.result_json) as TickResult);
  // 旧スキーマで保存された world に新フィールドが無い場合を補完（後方互換）
  for (const c of snapshot.world.characters) normalizeCharacter(c);
  for (const p of snapshot.world.places) normalizePlace(p);
  if (!snapshot.world.activeEvents) snapshot.world.activeEvents = [];
  return { runId: run.id, snapshot, log };
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
  // 固定口調（後付けフィールド）。旧データには無いので初期定義から id で補完する。
  if (typeof c.voice !== "string" || !c.voice) {
    c.voice = initialVoiceById().get(c.id) ?? "";
  }
}

/** 初期定義の id→voice マップ（初回だけ生成してキャッシュ）。 */
let _voiceById: Map<string, string> | null = null;
function initialVoiceById(): Map<string, string> {
  if (!_voiceById) {
    _voiceById = new Map(createInitialCharacters().map((d) => [d.id, d.voice]));
  }
  return _voiceById;
}

/** 旧データに欠けている民の霊力プール（清/濁）を、その地の実りからの推定値で補完する */
function normalizePlace(p: any): void {
  const cap = p.forage?.normal ?? 12;
  if (!p.populace) p.populace = { sei: cap * 3, daku: Math.round(cap * 1.5) };
  if (!p.populaceMax) p.populaceMax = { sei: p.populace.sei, daku: p.populace.daku };
  if (!p.regen) p.regen = { sei: Math.max(2, Math.round(cap / 2)), daku: 3 };
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
