// 到達可能性アウディット — 「絶対に会得できなさそうなスキル」「絶対に解放されなさそうなキャラ」を炙り出す。
//
// 二段で見る:
//   1. 静的チェック（コード論理）……実データに依らず、定義そのものが破綻していないか。
//        - skill.measure がどの行動でも 0 しか返さない（＝発火条件にどの Action も一致しない＝タイポ/死んだ条件）
//        - loop スコープなのに threshold が 1 周で構造的に届かない
//        - CHARACTER_UNLOCKS.isUnlocked が、全部マシマシの文脈でも false（＝論理的に充足不能）
//   2. 動的チェック（実ログ）……data/world.db に貯まった実進捗から、実際に伸びていないものを拾う。
//        - 専用監査ログ skill_audit（毎 tick のスナップ・時系列）があれば最優先で使う
//        - 無ければ最新 campaign の snapshot（現在値）＋ history（周ごと要約）でフォールバック
//
// 使い方:
//   bun run scripts/audit-reachability.ts             人が読むレポート（全キャラ）
//   bun run scripts/audit-reachability.ts kai shiori   キャラ解放セクションを指定 id に絞る
//   bun run scripts/audit-reachability.ts --json kai   絞り込み＋機械可読 JSON
//   DB_PATH=data/world.db bun run scripts/audit-reachability.ts
//
// 位置引数（"--" で始まらない引数）はキャラ id とみなし、キャラ解放の判定をそれだけに絞る。
// 指定が無ければ全キャラ。未知の id は黙って捨てず警告する（握りつぶし禁止）。
//
// 注意: 本スクリプトは read-only。世界は一切進めない。
import { Database } from "bun:sqlite";
import { SKILLS } from "../src/domain/skills.ts";
import { CHARACTER_UNLOCKS } from "../src/domain/characters.ts";
import { ACTIONS, ACTION_LABELS, REWARD_CHANNELS } from "../src/domain/types.ts";
import type { Action, CharacterTickResult, SkillDef } from "../src/domain/types.ts";

const asJson = process.argv.includes("--json");
const DB_PATH = process.env.DB_PATH ?? "data/world.db";
const ALL_SKILL_IDS = SKILLS.map((s) => s.id);

// 位置引数でキャラ解放の判定を絞り込む（"--xxx" はフラグ扱いで除外）。指定なし＝全キャラ。
const VALID_CHAR_IDS = CHARACTER_UNLOCKS.map((u) => u.id);
const charArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const unknownChars = charArgs.filter((a) => !VALID_CHAR_IDS.includes(a));
if (unknownChars.length > 0) {
  console.error(
    `⚠ 未知のキャラ id: ${unknownChars.join("、")}（解放対象キャラ: ${VALID_CHAR_IDS.join("、")}）。これらは無視します。`,
  );
}
const charFilter = new Set(charArgs.filter((a) => VALID_CHAR_IDS.includes(a)));
if (charArgs.length > 0 && charFilter.size === 0) {
  console.error("指定されたキャラ id が一つも有効でないため、終了します。");
  process.exit(1);
}

// ============================================================
// 1. 静的チェック（コード論理）
// ============================================================

/** measure をつつくための「その行動を取り、起こりうる報酬が全部出た」極大ヒーロー。 */
function maximalHero(action: Action): CharacterTickResult {
  const params = { altruism: 95, independence: 95, trust: 95 };
  return {
    id: "haru",
    name: "ハル",
    action,
    actionLabel: ACTION_LABELS[action],
    energyBefore: 50,
    energyAfter: 5, // 餓死寸前条件（energyAfter<=12）も拾えるように低め
    energyDelta: -45,
    paramsBefore: params,
    paramsAfter: params,
    paramDeltas: {},
    deltaReason: "",
    diary: "",
    relationLabel: "",
    stageBefore: "成熟",
    stageAfter: "成熟",
    stageChanged: false,
    died: false,
    placeId: "kibune",
    placeName: "貴船",
    moved: true,
    withPartner: true,
    targetId: "nagi", // 対人条件（targetId 必須）も拾えるように相手あり
    targetName: "ナギ",
    impulse: false,
    rewardEvents: [
      ...REWARD_CHANNELS.map((channel) => ({
        channel,
        label: "",
        base: 5,
        effective: 5,
      })),
      { channel: "stress" as const, label: "", base: -3, effective: -3 },
    ],
    mood: { elation: 1, calm: 1, warmth: 1, stress: 0 },
    antibodies: { achievement: 0, bond: 0, comfort: 0, thrill: 0 },
  } as CharacterTickResult;
}

/** その skill.measure が「どの行動でなら発火するか」を経験的に調べる（静的・実データ非依存）。 */
function probeSkillMeasure(skill: SkillDef): { live: boolean; triggers: Action[]; error?: string } {
  const triggers: Action[] = [];
  for (const action of ACTIONS) {
    try {
      const hero = maximalHero(action);
      // result/state は将来スキルが参照しても落ちないよう、よく使う最小限を埋めておく
      // （未充足で measure が例外を投げると「死んだ条件」と誤判定してしまうため）。
      const result = { day: 1, weather: "normal", characters: [hero] } as any;
      const state = { day: 1, weather: "normal", characters: [], places: [], activeEvents: [] } as any;
      const inc = skill.measure({ hero, result, state });
      if (inc > 0) triggers.push(action);
    } catch (e) {
      return { live: false, triggers, error: String(e) };
    }
  }
  return { live: triggers.length > 0, triggers };
}

/** loop スコープのスキルが 1 周で構造的に届くか（1 周はおおむね最長 30 日＝30日目の大禍まで）。 */
const MAX_DAYS_PER_LOOP = 30;

/** isUnlocked を様々な文脈でつついて、解放経路を割り出す。 */
function probeUnlock(isUnlocked: (ctx: { acquired: string[]; peakAltruism: number; loop: number }) => boolean) {
  // 全部マシマシでも false なら論理的に充足不能。
  const possible = isUnlocked({ acquired: ALL_SKILL_IDS, peakAltruism: 100, loop: 10_000 });
  // 各レバー単独での最小要件（他を 0 に固定）。
  let altruismMin: number | null = null;
  for (let a = 0; a <= 100; a++) {
    if (isUnlocked({ acquired: [], peakAltruism: a, loop: 1 })) { altruismMin = a; break; }
  }
  let loopMin: number | null = null;
  for (let l = 1; l <= 1000; l++) {
    if (isUnlocked({ acquired: [], peakAltruism: 0, loop: l })) { loopMin = l; break; }
  }
  return { possible, altruismMin, loopMin };
}

// ============================================================
// 2. 動的チェック（実ログ: data/world.db）
// ============================================================

interface RunData {
  hasDb: boolean;
  // skill_audit（時系列）から
  auditRows: number;
  auditDistinctLoops: number; // 監査ログに実在する distinct な周数（loop スコープ判定の信頼度）
  runId: number | null;
  // スキル: 通算で観測した最大進捗 / ループ内ピーク / 会得実績
  maxCareerProgress: Record<string, number>; // career: 末尾（通算）の最大
  maxLoopProgress: Record<string, number>; // loop: どこか1周での最大到達
  acquiredEver: Set<string>;
  rosterEver: Set<string>;
  peakAltruismEver: number;
  loopsElapsed: number; // 現在の周（=これまで何周ぶん回ったか）
  // snapshot / history フォールバック
  currentProgress: Record<string, number>;
  currentAcquired: string[];
  currentRoster: string[];
  currentPeakAltruism: number;
  history: { loop: number; days: number; altruismReached: number; acquiredSkills: string[] }[];
  source: string; // どのデータを使ったか（説明用）
}

function loadRunData(): RunData {
  const d: RunData = {
    hasDb: false,
    auditRows: 0,
    auditDistinctLoops: 0,
    runId: null,
    maxCareerProgress: {},
    maxLoopProgress: {},
    acquiredEver: new Set(),
    rosterEver: new Set(),
    peakAltruismEver: 0,
    loopsElapsed: 0,
    currentProgress: {},
    currentAcquired: [],
    currentRoster: [],
    currentPeakAltruism: 0,
    history: [],
    source: "（データ無し）",
  };

  let db: Database;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch {
    return d; // DB がまだ無い
  }
  d.hasDb = true;

  // --- 最新 run の正規化状態 / history（フォールバックの土台）---
  try {
    const row = db
      .query<
        { id: number; last_loop: number; hero_peak_altruism: number },
        []
      >(
        "SELECT id, last_loop, hero_peak_altruism FROM runs ORDER BY id DESC LIMIT 1",
      )
      .get();
    if (row) {
      d.runId = row.id;
      // スキル進捗（run_skill）
      const skillRows = db
        .query<{ skill_id: string; acquired: number; progress: number }, [number]>(
          "SELECT skill_id, acquired, progress FROM run_skill WHERE run_id = ?",
        )
        .all(row.id);
      d.currentProgress = Object.fromEntries(skillRows.map((r) => [r.skill_id, r.progress]));
      d.currentAcquired = skillRows.filter((r) => r.acquired).map((r) => r.skill_id);
      // ロスター（run_roster）
      d.currentRoster = db
        .query<{ char_id: string }, [number]>(
          "SELECT char_id FROM run_roster WHERE run_id = ?",
        )
        .all(row.id)
        .map((r) => r.char_id);
      d.currentPeakAltruism = row.hero_peak_altruism ?? 0;
      d.loopsElapsed = row.last_loop ?? 0;
      // 履歴（run_loop_summary）
      d.history = db
        .query<
          { loop: number; days: number; altruism_reached: number; acquired_skills_json: string },
          [number]
        >(
          "SELECT loop, days, altruism_reached, acquired_skills_json FROM run_loop_summary WHERE run_id = ? ORDER BY loop",
        )
        .all(row.id)
        .map((h) => ({
          loop: h.loop,
          days: h.days,
          altruismReached: h.altruism_reached ?? 0,
          acquiredSkills: JSON.parse(h.acquired_skills_json ?? "[]"),
        }));
      // history と現在値からの「これまで」を集約
      for (const s of d.currentAcquired) d.acquiredEver.add(s);
      for (const h of d.history) for (const s of h.acquiredSkills) d.acquiredEver.add(s);
      for (const r of d.currentRoster) d.rosterEver.add(r);
      d.peakAltruismEver = Math.max(d.currentPeakAltruism, ...d.history.map((h) => h.altruismReached), 0);
      d.source = `run #${row.id} の現在状態＋history（${d.history.length}周ぶん）`;
    }
  } catch {
    /* 表が無い等は無視 */
  }

  // --- 専用監査ログ skill_audit（あれば時系列で上書き・最優先）---
  try {
    const rows = db
      .query<
        {
          loop: number;
          day: number;
          hero_altruism: number;
          peak_altruism: number;
          acquired_json: string;
          progress_json: string;
          roster_json: string;
        },
        [number]
      >(
        "SELECT loop, day, hero_altruism, peak_altruism, acquired_json, progress_json, roster_json " +
          "FROM skill_audit WHERE run_id = ? ORDER BY loop, day",
      )
      .all(d.runId ?? -1);
    d.auditRows = rows.length;
    d.auditDistinctLoops = new Set(rows.map((r) => r.loop)).size;
    if (rows.length > 0) {
      // loop ごとの各スキル進捗ピーク（loop スコープの「毎周どこまで届いたか」）
      const perLoopMax: Record<string, Record<number, number>> = {};
      let maxLoop = 0;
      for (const r of rows) {
        maxLoop = Math.max(maxLoop, r.loop);
        d.peakAltruismEver = Math.max(d.peakAltruismEver, r.peak_altruism, r.hero_altruism);
        for (const id of JSON.parse(r.acquired_json) as string[]) d.acquiredEver.add(id);
        for (const id of JSON.parse(r.roster_json) as string[]) d.rosterEver.add(id);
        const prog = JSON.parse(r.progress_json) as Record<string, number>;
        for (const [id, v] of Object.entries(prog)) {
          // career: 通算なので全行の最大が「いまの到達」
          d.maxCareerProgress[id] = Math.max(d.maxCareerProgress[id] ?? 0, v);
          // loop: 周内ピークを周ごとに記録
          (perLoopMax[id] ??= {})[r.loop] = Math.max((perLoopMax[id]?.[r.loop] ?? 0), v);
        }
      }
      for (const [id, byLoop] of Object.entries(perLoopMax)) {
        d.maxLoopProgress[id] = Math.max(0, ...Object.values(byLoop));
      }
      d.loopsElapsed = Math.max(d.loopsElapsed, maxLoop);
      d.source = `skill_audit ${rows.length}行（実在${d.auditDistinctLoops}周分の時系列）＋ ${d.source}`;
    }
  } catch {
    /* skill_audit 表がまだ無い（監査ログ導入前のDB）→ フォールバックのまま */
  }

  db.close();
  return d;
}

// ============================================================
// 3. 判定とレポート
// ============================================================

type Verdict = "ok" | "watch" | "unreachable";
const MARK: Record<Verdict, string> = { ok: "🟢", watch: "🟡", unreachable: "🔴" };

interface SkillFinding {
  id: string;
  name: string;
  scope: "loop" | "career";
  threshold: number;
  verdict: Verdict;
  reason: string;
}

function judgeSkills(run: RunData): SkillFinding[] {
  const findings: SkillFinding[] = [];
  // 動的判定に十分な周回が回っているか（少なすぎる周回で「絶対無理」とは言わない）
  const enoughLoops = run.loopsElapsed >= 3;
  // loop スコープの「周内 0」判定は、監査ログに複数周の時系列が実在して初めて信頼できる。
  const haveLoopSeries = run.auditDistinctLoops >= 3;

  // measure が全行動で発火する＝行動非依存（状態/パラメータ依存）。文言を変えて誤解を防ぐ。
  const triggerDesc = (triggers: Action[]) =>
    triggers.length >= ACTIONS.length ? "達成条件（行動非依存）" : `寄与行動: ${triggers.join("/")}`;

  for (const skill of SKILLS) {
    const probe = probeSkillMeasure(skill);
    const trig = triggerDesc(probe.triggers);
    const acquiredEver = run.acquiredEver.has(skill.id);
    let verdict: Verdict = "watch";
    let reason = "";

    if (probe.error) {
      verdict = "unreachable";
      reason = `measure が例外で評価不能（定義バグの疑い）: ${probe.error}`;
    } else if (!probe.live) {
      verdict = "unreachable";
      reason =
        "どの行動でも measure が 0 のまま＝発火条件にどの Action も一致しない（行動名のタイポ／死んだ条件の疑い）";
    } else if (skill.scope === "loop" && skill.threshold > MAX_DAYS_PER_LOOP) {
      verdict = "unreachable";
      reason = `loop スコープなのに threshold=${skill.threshold} が 1 周の最長(${MAX_DAYS_PER_LOOP}日)を超える＝構造的に 1 周で届かない`;
    } else if (acquiredEver) {
      verdict = "ok";
      reason = `会得実績あり（${trig}）`;
    } else if (skill.scope === "career") {
      // career は通算。snapshot の現在値がそのまま「いまの通算到達」なので、現在値で判断できる。
      const total = Math.max(run.maxCareerProgress[skill.id] ?? 0, run.currentProgress[skill.id] ?? 0);
      if (total === 0 && enoughLoops) {
        verdict = "unreachable";
        reason = `通算${run.loopsElapsed}周で progress=0＝達成条件を一度も満たしていない（${trig}）`;
      } else if (total === 0) {
        verdict = "watch";
        reason = `progress=0 だがまだ ${run.loopsElapsed} 周のみ。周回不足で判断保留（${trig}）`;
      } else {
        verdict = "watch";
        reason = `進行中 ${total}/${skill.threshold}（通算）。ペース次第で到達見込み（${trig}）`;
      }
    } else {
      // loop スコープ。毎周どこまで届いたかが要る＝監査ログに複数周の時系列が実在して初めて断定できる。
      const loopPeak = run.maxLoopProgress[skill.id];
      if (haveLoopSeries && loopPeak !== undefined) {
        if (loopPeak === 0) {
          verdict = "unreachable";
          reason = `記録のある${run.auditDistinctLoops}周どの周でも周内 progress=0＝達成条件を満たせていない（${trig}）`;
        } else if (loopPeak < skill.threshold) {
          verdict = "watch";
          reason = `周内ピーク ${loopPeak}/${skill.threshold} 止まりで会得に未到達（要観察。${trig}）`;
        } else {
          // loopPeak >= threshold なのに acquiredEver=false ＝本来 advanceSkills が即習得させるはず。
          // 起きていれば advanceSkills のバグかログ不整合のシグナル（要調査）。
          verdict = "watch";
          reason = `周内ピーク ${loopPeak}/${skill.threshold}：閾値到達済みのはずが未習得＝習得処理かログの不整合の疑い（要調査。${trig}）`;
        }
      } else {
        verdict = "watch";
        reason = `loop スコープ。専用ログ(skill_audit)の周数が ${run.auditDistinctLoops} 周分のみで毎周の到達度が不明。世界を進めれば精度向上（${trig}）`;
      }
    }

    findings.push({ id: skill.id, name: skill.name, scope: skill.scope, threshold: skill.threshold, verdict, reason });
  }
  return findings;
}

interface CharFinding {
  id: string;
  name: string;
  requirement: string;
  verdict: Verdict;
  reason: string;
}

function judgeCharacters(run: RunData, skillFindings: SkillFinding[]): CharFinding[] {
  const acquirable = new Set(
    skillFindings.filter((f) => f.verdict !== "unreachable").map((f) => f.id),
  );
  const enoughLoops = run.loopsElapsed >= 3;
  const findings: CharFinding[] = [];

  for (const u of CHARACTER_UNLOCKS) {
    const { possible, altruismMin, loopMin } = probeUnlock(u.isUnlocked);
    const unlockedEver = run.rosterEver.has(u.id);
    let verdict: Verdict = "watch";
    let reason = "";

    // 解放経路の実現性
    const viaSkills = u.isUnlocked({ acquired: [...acquirable], peakAltruism: 0, loop: 1 });
    // 利他経路の見立ては観測ピークとの距離で 3 段階に分ける:
    //   reachable … 必要利他が観測ピーク+1 以内＝ほぼ届いている（🟡 寄り）
    //   far       … 必要利他が観測ピーク+40 超＝大きく乖離（他経路が無ければ 🔴 の根拠）
    //   その間     … どちらにも該当せず「厳しめだが不能とは言い切れない」（🟡）
    const altruismReachable =
      altruismMin !== null && altruismMin <= Math.max(run.peakAltruismEver, 0) + 1;
    const altruismFar = altruismMin !== null && altruismMin > run.peakAltruismEver + 40;
    const loopReachable = loopMin !== null; // 周を重ねれば届く（時間の問題）

    if (!possible) {
      verdict = "unreachable";
      reason = "全条件をマシマシにしても isUnlocked が false＝論理的に充足不能（解放条件が壊れている疑い）";
    } else if (unlockedEver) {
      verdict = "ok";
      reason = "解放実績あり（roster に登場済み）";
    } else if (viaSkills || altruismReachable || loopReachable) {
      verdict = "watch";
      const paths: string[] = [];
      if (viaSkills) paths.push("会得可能なスキル経由で解放可");
      if (altruismMin !== null) paths.push(`利他${altruismMin}以上で解放（現ピーク${run.peakAltruismEver}）`);
      if (loopMin !== null) paths.push(`${loopMin}周到達で解放（現${run.loopsElapsed}周）`);
      reason = `未解放だが到達経路あり: ${paths.join(" / ")}`;
    } else if (enoughLoops && altruismFar && !viaSkills && loopMin === null) {
      verdict = "unreachable";
      reason = `${run.loopsElapsed}周回しても未解放。スキル経路は会得不能スキル依存、利他は要${altruismMin}に対し観測ピーク${run.peakAltruismEver}と乖離、周回経路なし＝実質到達不能`;
    } else {
      verdict = "watch";
      const paths: string[] = [];
      if (altruismMin !== null) paths.push(`利他${altruismMin}以上（現ピーク${run.peakAltruismEver}）`);
      if (loopMin !== null) paths.push(`${loopMin}周（現${run.loopsElapsed}周）`);
      reason = `未解放。残る経路は厳しめ: ${paths.join(" / ") || "実質スキル依存のみ"}（要観察）`;
    }

    findings.push({ id: u.id, name: u.name, requirement: u.requirement, verdict, reason });
  }
  return findings;
}

// ============================================================
// 出力
// ============================================================

function main() {
  const run = loadRunData();
  const skills = judgeSkills(run);
  const chars = judgeCharacters(run, skills).filter(
    (f) => charFilter.size === 0 || charFilter.has(f.id),
  );

  if (asJson) {
    console.log(JSON.stringify({ source: run.source, run: { hasDb: run.hasDb, auditRows: run.auditRows, loopsElapsed: run.loopsElapsed, peakAltruismEver: run.peakAltruismEver }, skills, characters: chars }, null, 2));
    return;
  }

  const line = "─".repeat(72);
  console.log(line);
  console.log("到達可能性アウディット（絶対に会得/解放できなさそうなものを探す）");
  console.log(line);
  console.log(`データ元: ${run.source}`);
  if (charFilter.size > 0) console.log(`対象キャラ（解放）: ${[...charFilter].join("、")}`);
  if (!run.hasDb) console.log("⚠ data/world.db が見つからない。静的チェックのみ実施。");
  if (run.hasDb && run.auditRows === 0)
    console.log("ⓘ 専用ログ skill_audit はまだ空（監査ログ導入後に世界を進めると次回から時系列が貯まる）。\n  当面は snapshot＋history で判定。loop スコープのスキルは精度が落ちる点に注意。");
  console.log("");

  const order: Verdict[] = ["unreachable", "watch", "ok"];
  const byV = (arr: { verdict: Verdict }[], v: Verdict) => arr.filter((x) => x.verdict === v);

  console.log("■ スキル（会得式）");
  for (const v of order) {
    for (const f of byV(skills, v) as SkillFinding[]) {
      console.log(`  ${MARK[f.verdict]} ${f.name}（${f.id} / ${f.scope} / 閾値${f.threshold}）`);
      console.log(`       ${f.reason}`);
    }
  }
  console.log("");
  console.log("■ キャラ（解放条件）");
  for (const v of order) {
    for (const f of byV(chars, v) as CharFinding[]) {
      console.log(`  ${MARK[f.verdict]} ${f.name}（${f.id}）`);
      console.log(`       条件: ${f.requirement}`);
      console.log(`       ${f.reason}`);
    }
  }
  console.log("");

  const redSkills = byV(skills, "unreachable") as SkillFinding[];
  const redChars = byV(chars, "unreachable") as CharFinding[];
  console.log(line);
  console.log("総合判定");
  console.log(line);
  if (redSkills.length === 0 && redChars.length === 0) {
    console.log("🔴（絶対に無理そう）は無し。");
  } else {
    if (redSkills.length) console.log(`🔴 会得できなさそうなスキル: ${redSkills.map((f) => f.name).join("、")}`);
    if (redChars.length) console.log(`🔴 解放されなさそうなキャラ: ${redChars.map((f) => f.name).join("、")}`);
  }
  const watchN = byV(skills, "watch").length + byV(chars, "watch").length;
  if (watchN) console.log(`🟡 要観察: ${watchN} 件（上記参照）`);
}

main();
