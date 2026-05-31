// キャラ別ページ（全周横断）。重い TickResult ではなく char_metrics の薄い軌跡を
// /api/character/:id から取得し、そのキャラが登場した各回帰を、生存日数・利他のピーク・
// 結末つきの見出しで区切って、中に一行日記のタイムラインを並べる。
import { useEffect, useState } from "react";
import type { Chronicle, Talent } from "../../domain/types.ts";
import { createInitialCharacters } from "../../domain/characters.ts";
import { nameOfId, unlockOf } from "../util.ts";

const TALENT_LABEL: Record<Talent, string> = {
  insight: "観の眼（霊脈を読む）",
  bond: "結の力（地を癒す）",
  devour: "奪命（霊を喰らう）",
  none: "—",
};

/** /api/character/:id が返す char_metrics の1行（薄い軌跡）。 */
interface CharTrace {
  loop: number;
  day: number;
  place_name: string;
  diary: string;
  died: number;
  altruism: number;
  stage: string;
}

/** 1回帰ぶんのこのキャラの軌跡（見出し＋日記タイムライン）。 */
function LoopTrace({ loop, rows }: { loop: number; rows: CharTrace[] }) {
  const peakAltruism = Math.max(...rows.map((r) => r.altruism));
  const died = rows.some((r) => r.died);
  const last = rows[rows.length - 1];
  // 日記タイムラインは date desc（新しい日が上）。
  const daysDesc = [...rows].reverse();

  return (
    <section className="char-loop">
      <h3 className="char-loop-head">
        <a className="char-loop-num" href={`#/loop/${loop}`}>
          第 {loop} 回帰
        </a>
        <span className="char-loop-meta">
          {rows.length} 日・利他ピーク {peakAltruism}・{last.stage}
          {died ? "・力尽きた" : ""}
        </span>
      </h3>
      <ol className="char-days">
        {daysDesc.map((r) => (
          <li
            key={r.day}
            className={`char-day${r.died ? " char-day-died" : ""}`}
          >
            <span className="char-day-num">Day {r.day}</span>
            <span className="char-day-place">＠{r.place_name}</span>
            {r.diary && <span className="char-day-diary">「{r.diary}」</span>}
            {r.died ? <span className="char-day-end">— ここで消え去った</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CharacterPage({
  id,
  chronicle,
}: {
  id: string;
  chronicle: Chronicle | null;
}) {
  const def = createInitialCharacters().find((c) => c.id === id);
  const isHero = chronicle?.protagonistId === id;

  // まだ恒久ロスターに入っていない（＝未解放の）キャラか。chronicle があるときだけ判定できる。
  const locked = !!chronicle && !chronicle.roster.includes(id);

  // 全周横断の軌跡を char_metrics から取得（解放済みのときだけ）。
  const [trace, setTrace] = useState<CharTrace[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (locked) return;
    let alive = true;
    setError(null);
    fetch(`/api/character/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { trace?: CharTrace[] }) => {
        if (alive) setTrace(d.trace ?? []);
      })
      .catch((e) => {
        // 握りつぶさず可視化（「未登場」と混同させない）
        if (alive) setError(e instanceof Error ? e.message : "読み込み失敗");
      });
    return () => {
      alive = false;
    };
  }, [id, locked]);

  // 未解放キャラは正体を伏せ、「どうすれば京に現れるか（解放条件）」だけを見せる。
  if (locked) {
    const unlock = unlockOf(id);
    return (
      <div className="page">
        <div className="page-head">
          <a className="back-link" href="#/">
            ← ホーム
          </a>
          <h2 className="page-title">
            🔒 ???
            <span className="loop-badge">未解放</span>
          </h2>
        </div>
        <p className="page-empty">まだ京には現れていない者。</p>
        <section className="unlock-card">
          <h3>解放条件</h3>
          {unlock ? (
            <>
              <p className="unlock-req">{unlock.requirement}</p>
              <p className="unlock-hint">{unlock.describe}</p>
            </>
          ) : (
            <p className="unlock-req">この者が現れる条件は、まだ霧の中。</p>
          )}
          <p className="unlock-now">
            現在: 第 {chronicle?.loop ?? 1} 回帰 ／ ハルの会得スキル{" "}
            {chronicle?.skills.acquired.length ?? 0} 個 ／ 利他ピーク{" "}
            {chronicle?.heroPeakAltruism ?? 0}
          </p>
        </section>
      </div>
    );
  }

  // loop ごとに束ねて、新しい回帰が上に来るよう降順で並べる。
  const byLoop = new Map<number, CharTrace[]>();
  for (const r of trace) {
    const arr = byLoop.get(r.loop);
    if (arr) arr.push(r);
    else byLoop.set(r.loop, [r]);
  }
  const sections = [...byLoop.entries()]
    .map(([loop, rows]) => ({ loop, rows }))
    .sort((a, b) => b.loop - a.loop);

  return (
    <div className="page">
      <div className="page-head">
        <a className="back-link" href="#/">
          ← ホーム
        </a>
        <h2 className="page-title">
          {def?.name ?? nameOfId(id)}
          {isHero && <span className="loop-badge">主人公</span>}
        </h2>
      </div>

      {def && (
        <div className="char-profile">
          <img
            className="char-portrait"
            src={`/assets/characters/${def.id}.webp`}
            alt={def.name}
            loading="lazy"
            onError={(e) => {
              // まだ絵を生成していないキャラでは枠ごと隠す
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="char-profile-text">
            <p className="char-core">{def.core}</p>
            <p className="char-traits">
              <span>異能: {TALENT_LABEL[def.talent]}</span>
              <span>処世術: {def.initialLesson}</span>
            </p>
          </div>
        </div>
      )}

      {error ? (
        <p className="page-empty">読み込みに失敗しました: {error}</p>
      ) : sections.length === 0 ? (
        <p className="page-empty">このキャラはまだ登場していません。</p>
      ) : (
        sections.map((s) => (
          <LoopTrace key={s.loop} loop={s.loop} rows={s.rows} />
        ))
      )}
    </div>
  );
}
