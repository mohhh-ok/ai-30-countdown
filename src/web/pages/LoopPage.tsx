// 1回帰ぶんの物語ページ。その周の ticks を /api/loops/:loop から取得して FrontStage に渡し
// 舞台化する（ライブな world state は持たないので「京の気」ゲージは出ない）。閉じた回帰は
// 結末の要約を頭に添える。現在進行中の回帰はサーバがメモリの現周ログを返す。
import { useEffect, useState } from "react";
import type { Chronicle, TickResult } from "../../domain/types.ts";
import { FrontStage } from "../components/FrontStage.tsx";
import { skillName } from "../util.ts";

export function LoopPage({
  loop,
  chronicle,
}: {
  loop: number;
  chronicle: Chronicle | null;
}) {
  const sum = (chronicle?.history ?? []).find((s) => s.loop === loop);
  const live = (chronicle?.loop ?? 1) === loop && !sum;

  // その周の完全 ticks をオンデマンド取得（null=読み込み中）。
  const [ticks, setTicks] = useState<TickResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setTicks(null);
    setError(null);
    fetch(`/api/loops/${loop}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { ticks?: TickResult[] }) => {
        if (alive) setTicks(d.ticks ?? []);
      })
      .catch((e) => {
        // 握りつぶさず可視化（「記録なし」と混同させない）
        if (alive) setError(e instanceof Error ? e.message : "読み込み失敗");
      });
    return () => {
      alive = false;
    };
  }, [loop]);

  return (
    <div className="page">
      <div className="page-head">
        <a className="back-link" href="#/loops">
          ← 回帰一覧
        </a>
        <h2 className="page-title">
          第 {loop} 回帰
          {live && <span className="loop-badge live">進行中</span>}
        </h2>
      </div>

      {sum && (
        <div className="loop-summary">
          <span className="loop-summary-end">{sum.causeOfEnd}</span>
          <span>生存 {sum.days} 日</span>
          <span>
            到達 {sum.stageReached}（利他 {sum.altruismReached}）
          </span>
          {sum.acquiredSkills.length > 0 && (
            <span>✨ {sum.acquiredSkills.map(skillName).join("・")}</span>
          )}
        </div>
      )}

      {error ? (
        <p className="page-empty">読み込みに失敗しました: {error}</p>
      ) : ticks === null ? (
        <p className="page-empty">読み込み中…</p>
      ) : ticks.length === 0 ? (
        <p className="page-empty">この回帰の記録はありません。</p>
      ) : (
        <FrontStage log={ticks} chronicle={chronicle} />
      )}
    </div>
  );
}
