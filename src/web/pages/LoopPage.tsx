// 1回帰ぶんの物語ページ。その周のログだけを FrontStage に渡して舞台化する
// （ライブな world state は持たないので「京の気」ゲージは出ない）。閉じた回帰は
// 結末の要約を頭に添える。
import type { Chronicle, TickResult } from "../../domain/types.ts";
import { FrontStage } from "../components/FrontStage.tsx";
import { skillName, ticksOfLoop } from "../util.ts";

export function LoopPage({
  loop,
  log,
  chronicle,
}: {
  loop: number;
  log: TickResult[];
  chronicle: Chronicle | null;
}) {
  const ticks = ticksOfLoop(log, loop);
  const sum = (chronicle?.history ?? []).find((s) => s.loop === loop);
  const live = (chronicle?.loop ?? 1) === loop && !sum;

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

      {ticks.length === 0 ? (
        <p className="page-empty">この回帰の記録はありません。</p>
      ) : (
        <FrontStage log={ticks} chronicle={chronicle} />
      )}
    </div>
  );
}
