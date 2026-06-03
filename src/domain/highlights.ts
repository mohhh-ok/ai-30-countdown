// 年代記＝ハイライト。全周をまたいだ表示用ログ（TickResult[]）から、2層の見どころを
// ルールベースで抽出する（LLM を使わない・決定的）。
//
//  1. 回帰を超えたハイライト（crossLoopHighlights）
//     全周を貫く「持ち越し級／初めて起きた」節目。スキル会得・キャラ解放・
//     段階の初到達・最長生存の更新。＝視聴者だけが追えるメタ進行の糸。
//     ※力尽き（回帰そのもの）はこの年代記には出さない。回帰内の見せ場側に任せる。
//
//  2. その回帰内のハイライト（loopHighlights）
//     ある一周回の中の山場。その一生のティックを点数化し、上位だけを日付順に拾う。
//     死の場面・出会い（会話劇）・天変地異・禁忌・餓えの淵・段階変化など。
//
// どちらも client（Highlights.tsx）が描画に使う。
import type {
  CharacterTickResult,
  LoopSummary,
  MetaEvent,
  TickResult,
} from "./types.ts";

export type HighlightKind =
  // 回帰を超えた節目
  | "skill"
  | "unlock"
  | "regress"
  | "stage"
  | "record"
  // 回帰内の山場
  | "death"
  | "worldEvent"
  | "taboo"
  | "frenzy"
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
 * ある一周回のログから、回帰を超えた年代記に焼き付けるメタ節目を日付付きで取り出す。
 * - スキル会得 / キャラ解放: 周回をまたいで持ち越される2つ（plan.md 第13節）。
 * - 段階到達: ハルがその周で段階を上げた瞬間（「初到達」の判定は周をまたぐ chronicleHighlights 側で行う）。
 * 力尽き（回帰そのもの）・最長更新はここには出さない（最長更新は記録ベースで chronicleHighlights が拾う）。
 * closeLoop がこの結果を LoopSummary.metaHighlights に保存し、過去周の全周ログ無しでも年代記を描けるようにする。
 */
export function loopMetaHighlights(
  loopLog: TickResult[],
  heroId?: string,
): MetaEvent[] {
  const out: MetaEvent[] = [];
  for (const t of loopLog) {
    const hero = heroId
      ? t.characters.find((c) => c.id === heroId)
      : undefined;
    if (t.acquiredSkills?.length) {
      out.push({
        day: t.day,
        kind: "skill",
        text: `ハル、「${t.acquiredSkills.join("」「")}」を会得`,
      });
    }
    if (t.unlockedCharacters?.length) {
      out.push({
        day: t.day,
        kind: "unlock",
        text: `${t.unlockedCharacters.join("・")} 解放（次の回帰から登場）`,
      });
    }
    if (hero?.stageChanged) {
      out.push({
        day: t.day,
        kind: "stage",
        text: `ハル、初めて「${hero.stageAfter}」に至る`,
      });
    }
  }
  return out;
}

/**
 * 回帰を超えた年代記。
 * 閉じた各周の LoopSummary（メタ節目＋生存日数）と進行中の周のメタ節目を、古い順に貫いて並べる。
 * - スキル会得 / キャラ解放: 各周の metaHighlights をそのまま採る。
 * - 段階の初到達: 同一段階の到達は全周で最初の1度だけ残す（文言が段階を一意に表すので文言で重複排除）。
 * - 最長生存の更新: 閉じた周の生存日数が過去最長を超えた周だけ、前向きな節目として拾う。
 * 力尽き（回帰そのもの）は出さない。進行中の周はまだ閉じていないので最長更新の対象にしない。
 */
export function chronicleHighlights(
  closed: LoopSummary[],
  current?: { loop: number; events: MetaEvent[] },
): Highlight[] {
  const out: Highlight[] = [];
  const stageTextSeen = new Set<string>();
  let maxDays = 0;

  const pushEvents = (loop: number, events: MetaEvent[]) => {
    for (const e of events) {
      // 段階到達は周をまたいで初回だけ（文言が段階を一意に表す）。
      if (e.kind === "stage") {
        if (stageTextSeen.has(e.text)) continue;
        stageTextSeen.add(e.text);
      }
      out.push({ loop, day: e.day, kind: e.kind, text: e.text });
    }
  };

  for (const s of closed) {
    pushEvents(s.loop, s.metaHighlights ?? []);
    if (s.days > maxDays) {
      maxDays = s.days;
      out.push({
        loop: s.loop,
        day: s.days,
        kind: "record",
        text: `最長生存を更新（${s.days}日）`,
      });
    }
  }
  if (current) pushEvents(current.loop, current.events);
  return out;
}

/** 1ティックから読み取れる「面白さ」のシグナル（重み付き）。 */
interface Signal {
  weight: number;
  kind: HighlightKind;
  text: string;
}

/**
 * 見せ場（観客向け）の scene 用に、その日の出来事を「短い一行」に詰める。
 * engine の `notable` は各キャラの deltaReason（長い説明文）まで全部結合していて
 * 観客ビューには冗長すぎる。ここでは構造化フィールドだけから組み直し、
 * 出会い（同室）＞移動 の順で最も絵になる一点に絞る。詳細（理由つきフル文）は
 * `notable` のまま楽屋ビュー（TickLog）に残す。該当が無ければ空＝シーン化しない。
 */
function briefScene(t: TickResult): string {
  const living = t.characters.filter((c) => !c.died);
  // 同じ場所に2人以上いて、その日に誰かが移動してきた＝「居合わせた」瞬間。
  const byPlace = new Map<string, CharacterTickResult[]>();
  for (const c of living) {
    const arr = byPlace.get(c.placeId) ?? [];
    arr.push(c);
    byPlace.set(c.placeId, arr);
  }
  const meets: string[] = [];
  for (const members of byPlace.values()) {
    if (members.length >= 2 && members.some((m) => m.moved)) {
      meets.push(
        `${members[0].placeName}で${members.map((m) => m.name).join("と")}が居合わせた`,
      );
    }
  }
  if (meets.length) return meets.join("／");
  // 出会いが無ければ移動だけを簡潔に（「名→行き先」をカンマ区切り）。
  const moves = living
    .filter((c) => c.moved)
    .map((c) => `${c.name}→${c.placeName}`);
  if (moves.length) return `移動: ${moves.join("、")}`;
  return "";
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
  // 禁忌「奪う」: 誰かが他者から霊を奪った日（hero に限らずカイ等も）。代償付きの大きな決断＝山場。
  for (const c of t.characters) {
    if (c.action !== "steal") continue;
    const from = c.targetName ? `${c.targetName}から` : "";
    s.push({
      weight: 30,
      kind: "taboo",
      text: `${c.name}、${from}霊を奪う（禁忌）`,
    });
  }
  // 荒ぶり（変身）とその鎮め: 半妖カイの暴走とハルの鎮めの術。観客向けの大見せ場。
  for (const c of t.characters) {
    if (c.becameFrenzied) {
      s.push({ weight: 38, kind: "frenzy", text: `${c.name}、荒ぶりに堕つ（変身）` });
    }
    if (c.quelledFrenzy) {
      s.push({ weight: 36, kind: "frenzy", text: `${c.name}、荒ぶりを鎮める` });
    }
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
  if (t.tempo === "scene") {
    const brief = briefScene(t);
    if (brief) s.push({ weight: 8, kind: "scene", text: brief });
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
