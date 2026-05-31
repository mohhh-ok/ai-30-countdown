// 年代記（重要イベントの常設パネル）。
// スキル会得・キャラ解放・回帰といった「節目」は TickLog / FrontStage の各日に
// 埋もれて流れてしまうので、ログ全体から拾い直してここに常時表示する。
// 表（観客）・裏（楽屋）どちらのビューでも、画面上部に貼り付いて見え続ける。
import { useState } from "react";
import type { TickResult } from "../../domain/types.ts";

type MarkKind = "skill" | "unlock" | "regress";

interface Highlight {
  loop?: number;
  day: number;
  kind: MarkKind;
  text: string;
}

/** ログ全体を走査して、節目イベントだけを古い順に取り出す。 */
function collectHighlights(log: TickResult[]): Highlight[] {
  const out: Highlight[] = [];
  for (const t of log) {
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
    if (t.regressed) {
      out.push({
        loop: t.loop,
        day: t.day,
        kind: "regress",
        text: "ハル力尽き、時は巻き戻る",
      });
    }
  }
  return out;
}

const KIND_ICON: Record<MarkKind, string> = {
  skill: "✨",
  unlock: "🆕",
  regress: "↻",
};

export function Highlights({ log }: { log: TickResult[] }) {
  const [open, setOpen] = useState(true);
  const events = collectHighlights(log);
  if (events.length === 0) return null;

  // 新しい順（直近の節目を上に）。
  const items = [...events].reverse();

  return (
    <section className={`highlights${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="highlights-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="highlights-title">📜 年代記</span>
        <span className="highlights-count">{events.length} 件</span>
        <span className="highlights-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ol className="highlights-list">
          {items.map((h, i) => (
            <li key={i} className={`highlight mark-${h.kind}`}>
              <span className="highlight-when">
                {h.loop != null && <span className="highlight-loop">L{h.loop}</span>}
                Day {h.day}
              </span>
              <span className="highlight-icon">{KIND_ICON[h.kind]}</span>
              <span className="highlight-text">{h.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
