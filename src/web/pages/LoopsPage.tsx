// 回帰一覧ページ。全周をカードで並べ、各回帰ページへのリンクにする。
// 閉じた回帰は chronicle.history の要約（結末・到達段階・会得スキル）を、
// 進行中の回帰は経過日数を見せる。全周ログは持たず chronicle だけで描く
// （進行中の経過日数だけは現周ログの長さを currentDays として受け取る）。
import type { Chronicle, LoopSummary } from "../../domain/types.ts";
import { skillName } from "../util.ts";

export function LoopsPage({
  chronicle,
  currentDays,
}: {
  chronicle: Chronicle | null;
  currentDays: number;
}) {
  const current = chronicle?.loop ?? 1;
  const summaries = new Map<number, LoopSummary>(
    (chronicle?.history ?? []).map((s) => [s.loop, s]),
  );
  // 1..current の全周。閉じた周は history、現周は経過日数で見せる。
  const loops = Array.from({ length: current }, (_, i) => i + 1);
  // 2周目以降は回帰直後（現周0日）でも過去周カードを出すべきなので current>1 も「あり」とみなす。
  const hasAny = summaries.size > 0 || currentDays > 0 || current > 1;

  return (
    <div className="page">
      <h2 className="page-title">📜 回帰の年代記</h2>
      {!hasAny ? (
        <p className="page-empty">まだ記録がありません。ホームで物語を進めましょう。</p>
      ) : (
        <div className="loop-grid">
          {loops
            .slice()
            .reverse()
            .map((n) => {
              const sum = summaries.get(n);
              const live = n === current && !sum;
              return (
                <a key={n} className="loop-card" href={`#/loop/${n}`}>
                  <div className="loop-card-head">
                    <span className="loop-card-num">第 {n} 回帰</span>
                    {live ? (
                      <span className="loop-badge live">進行中</span>
                    ) : (
                      <span className="loop-badge">{sum?.days ?? currentDays} 日</span>
                    )}
                  </div>
                  {sum ? (
                    <>
                      <p className="loop-card-end">{sum.causeOfEnd}</p>
                      <p className="loop-card-meta">
                        到達: {sum.stageReached}（利他 {sum.altruismReached}）
                      </p>
                      {sum.acquiredSkills.length > 0 && (
                        <p className="loop-card-skills">
                          ✨ {sum.acquiredSkills.map(skillName).join("・")}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="loop-card-meta">{currentDays} 日経過</p>
                  )}
                </a>
              );
            })}
        </div>
      )}
    </div>
  );
}
