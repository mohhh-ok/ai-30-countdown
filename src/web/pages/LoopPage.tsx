// 1回帰ぶんの物語ページ。その周の ticks を /api/loops/:loop から取得して FrontStage に渡し
// 舞台化する（ライブな world state は持たないので「京の気」ゲージは出ない）。閉じた回帰は
// 結末の要約を頭に添える。現在進行中の回帰はサーバがメモリの現周ログを返す。
import { useEffect, useState } from "react";
import type { Chronicle, TickResult } from "../../domain/types.ts";
import { FrontStage } from "../components/FrontStage.tsx";
import { Highlights } from "../components/Highlights.tsx";
import { LoopSelect } from "../components/LoopSelect.tsx";
import { skillName } from "../util.ts";
import { useDomainNames, useLoopEnd, useSep, useT } from "../i18n.tsx";

export function LoopPage({
  loop,
  chronicle,
}: {
  loop: number;
  chronicle: Chronicle | null;
}) {
  const t = useT();
  const dn = useDomainNames();
  const sep = useSep();
  const loopEnd = useLoopEnd();
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
        if (alive) setError(e instanceof Error ? e.message : t("comm_error"));
      });
    return () => {
      alive = false;
    };
  }, [loop]);

  return (
    <div className="page">
      <div className="page-head">
        <a className="back-link" href="#/">
          {t("back_home")}
        </a>
        <h2 className="page-title">
          {t("loop_label", { n: loop })}
          {live && <span className="loop-badge live">{t("loops_live")}</span>}
        </h2>
        {/* 回帰ジャンプのセレクトはページ右肩に置く */}
        <span className="loop-select-right">
          <LoopSelect chronicle={chronicle} value={loop} />
        </span>
      </div>

      {sum && (
        <div className="loop-summary">
          <span className="loop-summary-end">{loopEnd(sum)}</span>
          <span>{t("loop_survived", { n: sum.days })}</span>
          <span>
            {t("loops_reached", {
              stage: dn.stage(sum.stageReached),
              alt: sum.altruismReached,
            })}
          </span>
          {sum.acquiredSkills.length > 0 && (
            <span>
              {t("loops_skills", {
                skills: sum.acquiredSkills
                  .map((sid) => dn.skill(sid, skillName(sid)))
                  .join(sep.list),
              })}
            </span>
          )}
        </div>
      )}

      {/* 進行中の周にも先頭サマリーを出す（閉じた周の要約に相当する経過日数） */}
      {live && !error && ticks !== null && ticks.length > 0 && (
        <div className="loop-summary">
          <span>{t("loops_elapsed", { n: ticks.length })}</span>
        </div>
      )}

      {error ? (
        <p className="page-empty">{t("load_failed", { error })}</p>
      ) : ticks === null ? (
        <p className="page-empty">{t("loading")}</p>
      ) : ticks.length === 0 ? (
        <p className="page-empty">{t("loop_no_record")}</p>
      ) : (
        // ホームと同じ2カラム構成。右肩に「第N回帰の見せ場」（＝閲覧中の周）を出す。
        // live な周は現周ログとして年代記へ足し、閉じた周は焼き付け済みなので足さない（liveLog）。
        <div className="body-cols">
          <div className="main-col">
            <FrontStage log={ticks} chronicle={chronicle} />
          </div>
          <aside className="side-col">
            <Highlights log={ticks} chronicle={chronicle} loop={loop} liveLog={live} />
          </aside>
        </div>
      )}
    </div>
  );
}
