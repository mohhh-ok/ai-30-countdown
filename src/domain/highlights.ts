// 年代記＝ハイライト。全周をまたいだ表示用ログ（TickResult[]）から、2層の見どころを
// ルールベースで抽出する（LLM を使わない・決定的）。
//
//  1. 回帰を超えたハイライト（crossLoopHighlights）
//     全周を貫く「持ち越し級／初めて起きた」節目。スキル会得・キャラ解放・回帰（一生の終わり）・
//     段階の初到達・最長生存の更新。＝視聴者だけが追えるメタ進行の糸。
//
//  2. その回帰内のハイライト（loopHighlights）
//     ある一周回の中の山場。その一生のティックを点数化し、上位だけを日付順に拾う。
//     死の場面・出会い（会話劇）・天変地異・禁忌・餓えの淵・段階変化など。
//
// どちらも client（Highlights.tsx）が描画に使う。
import type { Stage, TickResult } from "./types.ts";

export type HighlightKind =
  // 回帰を超えた節目
  | "skill"
  | "unlock"
  | "regress"
  | "stage"
  // 回帰内の山場
  | "death"
  | "worldEvent"
  | "taboo"
  | "peril"
  | "dialogue"
  | "scene";

export interface Highlight {
  loop?: number;
  day: number;
  kind: HighlightKind;
  text: string;
  /** 回帰内ハイライトの抽出スコア（上位選抜・デバッグ用。回帰超えでは未設定）。 */
  score?: number;
}

/**
 * 回帰を超えた年代記。
 * 全周ログを古い順に走査し、メタ進行の節目だけを取り出す。
 * - スキル会得 / キャラ解放: 周回をまたいで持ち越される2つ（plan.md 第13節）。
 * - 段階の初到達: ハルが「揺らぎ」「成熟」へ全周で初めて至った瞬間（1度だけ）。
 * - 回帰: 一生の終わり。生存日数が過去最長を更新したらその旨も添える。
 */
export function crossLoopHighlights(
  log: TickResult[],
  heroId?: string,
): Highlight[] {
  const out: Highlight[] = [];
  const stageSeen = new Set<Stage>();
  let maxDays = 0;
  for (const t of log) {
    const hero = heroId
      ? t.characters.find((c) => c.id === heroId)
      : undefined;

    if (t.acquiredSkills?.length) {
      out.push({
        loop: t.loop,
        day: t.day,
        kind: "skill",
        text: `ハル、「${t.acquiredSkills.join("」「")}」を会得`,
      });
    }
    if (t.unlockedCharacters?.length) {
      out.push({
        loop: t.loop,
        day: t.day,
        kind: "unlock",
        text: `${t.unlockedCharacters.join("・")} 解放（次の回帰から登場）`,
      });
    }
    if (hero?.stageChanged && !stageSeen.has(hero.stageAfter)) {
      stageSeen.add(hero.stageAfter);
      out.push({
        loop: t.loop,
        day: t.day,
        kind: "stage",
        text: `ハル、初めて「${hero.stageAfter}」に至る`,
      });
    }
    if (t.regressed) {
      const life = t.day; // 周回内の day はその一生の長さ（周ごとに1から数え直す）
      const record = life > maxDays;
      if (record) maxDays = life;
      out.push({
        loop: t.loop,
        day: t.day,
        kind: "regress",
        text: record
          ? `ハル力尽き、時は巻き戻る（${life}日＝最長生存を更新）`
          : "ハル力尽き、時は巻き戻る",
      });
    }
  }
  return out;
}

/** 1ティックから読み取れる「面白さ」のシグナル（重み付き）。 */
interface Signal {
  weight: number;
  kind: HighlightKind;
  text: string;
}

/**
 * そのティックの見どころシグナルを列挙する。
 * 複数当たれば score は総和、見出しの kind/text は最も重いシグナルを採用する。
 */
function tickSignals(
  t: TickResult,
  heroId: string,
): Signal[] {
  const hero = t.characters.find((c) => c.id === heroId);
  const where = hero?.placeName ? hero.placeName : "";
  const s: Signal[] = [];

  if (t.regressed) {
    s.push({
      weight: 100,
      kind: "regress",
      text: where ? `${where}でハル力尽きる` : "ハル力尽きる",
    });
  }
  // 脇役の力尽き（主役の死は regress として別格で拾うので除外）。
  // 一生の退場は会得・解放より重い山場として扱う。
  const fallen = t.characters.filter((c) => c.died && c.id !== heroId);
  if (fallen.length) {
    const names = fallen.map((c) => c.name);
    s.push({ weight: 50, kind: "death", text: `${names.join("・")}、力尽きる` });
  }
  if (t.acquiredSkills?.length) {
    s.push({
      weight: 45,
      kind: "skill",
      text: `「${t.acquiredSkills.join("」「")}」を会得`,
    });
  }
  if (t.unlockedCharacters?.length) {
    s.push({
      weight: 40,
      kind: "unlock",
      text: `${t.unlockedCharacters.join("・")} を解放`,
    });
  }
  if (hero?.stageChanged) {
    s.push({
      weight: 32,
      kind: "stage",
      text: `ハル、${hero.stageBefore}→${hero.stageAfter}へ`,
    });
  }
  if (t.newWorldEvents?.length) {
    const ev = t.newWorldEvents
      .map((e) => `${e.icon}${e.name}`)
      .join("・");
    s.push({ weight: 24, kind: "worldEvent", text: `${ev} 起こる` });
  }
  if (hero?.forageDraw?.taboo) {
    s.push({
      weight: 20,
      kind: "taboo",
      text: where ? `${where}で禁忌に触れる` : "禁忌に触れる",
    });
  }
  if (hero && !t.regressed && hero.energyAfter <= 2) {
    s.push({
      weight: 16,
      kind: "peril",
      text: `ハル、餓えの淵（霊力 ${hero.energyAfter}）`,
    });
  }
  if (t.dialogue?.length) {
    const names = [...new Set(t.dialogue.map((d) => d.speakerName))];
    s.push({
      weight: 12,
      kind: "dialogue",
      text: names.length >= 2 ? `${names.join("と")}の会話` : "会話劇",
    });
  }
  if (t.tempo === "scene" && t.notable) {
    s.push({ weight: 8, kind: "scene", text: t.notable });
  }
  return s;
}

/**
 * ある一周回の見せ場。
 * 指定 loop のティックだけを点数化し、score 上位 topN を日付順で返す。
 * 見出しの種類/文言は各ティックで最も重いシグナルを採る。
 */
export function loopHighlights(
  log: TickResult[],
  loop: number,
  heroId: string,
  topN = 5,
): Highlight[] {
  const scored: Highlight[] = [];
  for (const t of log) {
    if ((t.loop ?? 1) !== loop) continue;
    const sigs = tickSignals(t, heroId);
    if (sigs.length === 0) continue;
    const head = sigs.reduce((a, b) => (b.weight > a.weight ? b : a));
    const score = sigs.reduce((sum, sig) => sum + sig.weight, 0);
    scored.push({ loop, day: t.day, kind: head.kind, text: head.text, score });
  }
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const picked = scored.slice(0, topN);
  picked.sort((a, b) => a.day - b.day); // 表示は時系列順
  return picked;
}
