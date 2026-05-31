// キャラ別ページ（全周横断）。そのキャラが登場した各回帰を、生存日数・利他のピーク・
// 結末つきの見出しで区切り、中に一行日記のタイムラインを並べる。
import type {
  CharacterTickResult,
  Chronicle,
  Talent,
  TickResult,
} from "../../domain/types.ts";
import { createInitialCharacters } from "../../domain/characters.ts";
import { loopNumbers, nameOfId, ticksOfLoop } from "../util.ts";

const TALENT_LABEL: Record<Talent, string> = {
  insight: "観の眼（霊脈を読む）",
  bond: "結の力（地を癒す）",
  devour: "奪命（霊を喰らう）",
  none: "—",
};

interface LoopEntry {
  t: TickResult;
  c: CharacterTickResult;
}

/** 1回帰ぶんのこのキャラの軌跡（見出し＋日記タイムライン）。 */
function LoopTrace({ loop, entries }: { loop: number; entries: LoopEntry[] }) {
  const peakAltruism = Math.max(...entries.map((e) => e.c.paramsAfter.altruism));
  const last = entries[entries.length - 1].c;
  const died = entries.some((e) => e.c.died);

  return (
    <section className="char-loop">
      <h3 className="char-loop-head">
        <a className="char-loop-num" href={`#/loop/${loop}`}>
          第 {loop} 回帰
        </a>
        <span className="char-loop-meta">
          {entries.length} 日・利他ピーク {peakAltruism}・{last.stageAfter}
          {died ? "・力尽きた" : ""}
        </span>
      </h3>
      <ol className="char-days">
        {entries.map(({ t, c }) => (
          <li
            key={t.day}
            className={`char-day${c.died ? " char-day-died" : ""}`}
          >
            <span className="char-day-num">Day {t.day}</span>
            <span className="char-day-place">＠{c.placeName}</span>
            {c.diary && <span className="char-day-diary">「{c.diary}」</span>}
            {c.died && <span className="char-day-end">— ここで消え去った</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CharacterPage({
  id,
  log,
  chronicle,
}: {
  id: string;
  log: TickResult[];
  chronicle: Chronicle | null;
}) {
  const def = createInitialCharacters().find((c) => c.id === id);
  const isHero = chronicle?.protagonistId === id;

  const sections = loopNumbers(log)
    .map((loop) => {
      const entries = ticksOfLoop(log, loop)
        .map((t) => ({ t, c: t.characters.find((x) => x.id === id) }))
        .filter((e): e is LoopEntry => e.c != null);
      return { loop, entries };
    })
    .filter((s) => s.entries.length > 0)
    .reverse();

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

      {sections.length === 0 ? (
        <p className="page-empty">このキャラはまだ登場していません。</p>
      ) : (
        sections.map((s) => (
          <LoopTrace key={s.loop} loop={s.loop} entries={s.entries} />
        ))
      )}
    </div>
  );
}
