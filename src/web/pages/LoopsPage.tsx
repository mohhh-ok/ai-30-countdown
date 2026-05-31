// 回帰一覧ページ。全周をカードで並べ、各回帰ページへのリンクにする。
// 閉じた回帰は chronicle.history の要約（結末・到達段階・会得スキル）を、
// 進行中の回帰は経過日数を見せる。
import type { Chronicle, LoopSummary, TickResult } from "../../domain/types.ts";
import { loopNumbers, skillName, ticksOfLoop } from "../util.ts";

export function LoopsPage({
  log,
  chronicle,
}: {
  log: TickResult[];
  chronicle: Chronicle | null;
}) {
  const loops = loopNumbers(log);
  const current = chronicle?.loop ?? 1;
  const summaries = new Map<number, LoopSummary>(
    (chronicle?.history ?? []).map((s) => [s.loop, s]),
  );

  return (
    <div className="page">
      <h2 className="page-title">📜 回帰の年代記</h2>
      {loops.length === 0 ? (
        <p className="page-empty">まだ記録がありません。ホームで物語を進めましょう。</p>
      ) : (
        <div className="loop-grid">
          {loops
            .slice()
            .reverse()
            .map((n) => {
              const sum = summaries.get(n);
              const ticks = ticksOfLoop(log, n);
              const live = n === current && !sum;
              return (
                <a key={n} className="loop-card" href={`#/loop/${n}`}>
                  <div className="loop-card-head">
                    <span className="loop-card-num">第 {n} 回帰</span>
                    {live ? (
                      <span className="loop-badge live">進行中</span>
                    ) : (
                      <span className="loop-badge">{sum?.days ?? ticks.length} 日</span>
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
                    <p className="loop-card-meta">{ticks.length} 日経過</p>
                  )}
                </a>
              );
            })}
        </div>
      )}
    </div>
  );
}
