// 年代記（ハイライトの常設パネル）。2層で見せる。
//  ① 回帰を超えた年代記: 全周を貫くメタ進行の糸（スキル・解放・回帰・段階初到達）。
//  ② この回帰の見せ場: 現在の周回だけを点数化して拾った山場（死・出会い・天変地異・禁忌…）。
// どちらも全周ログ（log）から domain/highlights.ts がルールベースで抽出する（LLM 不使用）。
import { useState } from "react";
import type { Chronicle, TickResult } from "../../domain/types.ts";
import {
  type Highlight,
  type HighlightKind,
  crossLoopHighlights,
  loopHighlights,
} from "../../domain/highlights.ts";

const KIND_ICON: Record<HighlightKind, string> = {
  skill: "✨",
  unlock: "🆕",
  regress: "↻",
  stage: "🌱",
  record: "🏅",
  death: "💀",
  worldEvent: "🌀",
  taboo: "⛩️",
  peril: "🥀",
  dialogue: "💬",
  scene: "🎬",
};

/** ハイライト1件の行。回帰超えは L＋Day、回帰内は Day のみ表示する。 */
function HighlightRow({ h, showLoop }: { h: Highlight; showLoop: boolean }) {
  return (
    <li className={`highlight mark-${h.kind}`}>
      <span className="highlight-when">
        {showLoop && h.loop != null && (
          <span className="highlight-loop">L{h.loop}</span>
        )}
        Day {h.day}
      </span>
      <span className="highlight-icon">{KIND_ICON[h.kind]}</span>
      <span className="highlight-text">{h.text}</span>
    </li>
  );
}

/** 折りたためる1ブロック（見出し＋件数＋リスト）。 */
function HighlightBlock({
  title,
  items,
  showLoop,
  empty,
  defaultOpen,
}: {
  title: string;
  items: Highlight[];
  showLoop: boolean;
  empty: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`highlights-block${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="highlights-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="highlights-title">{title}</span>
        <span className="highlights-count">{items.length} 件</span>
        <span className="highlights-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {open &&
        (items.length === 0 ? (
          <p className="highlights-empty">{empty}</p>
        ) : (
          <ol className="highlights-list">
            {items.map((h, i) => (
              <HighlightRow key={i} h={h} showLoop={showLoop} />
            ))}
          </ol>
        ))}
    </div>
  );
}

export function Highlights({
  log,
  chronicle,
}: {
  log: TickResult[];
  chronicle: Chronicle | null;
}) {
  const heroId = chronicle?.protagonistId ?? "haru";
  const currentLoop = chronicle?.loop ?? 1;

  // どちらも新しい順（date desc・直近を上に）。
  const meta = crossLoopHighlights(log, heroId).reverse();
  const loopTop = loopHighlights(log, currentLoop, heroId, 5).reverse();

  if (meta.length === 0 && loopTop.length === 0) return null;

  return (
    <section className="highlights">
      <HighlightBlock
        title={`🎬 第 ${currentLoop} 回帰の見せ場`}
        items={loopTop}
        showLoop={false}
        empty="この回帰の見せ場はこれから"
        defaultOpen
      />
      <HighlightBlock
        title="📜 回帰を超えた年代記"
        items={meta}
        showLoop
        empty="まだ節目はない"
        defaultOpen
      />
    </section>
  );
}
