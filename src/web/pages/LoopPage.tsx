// 1回帰ぶんの物語ページ。その周の ticks を /api/loops/:loop から取得して FrontStage に渡し
// 舞台化する（ライブな world state は持たないので「京の気」ゲージは出ない）。閉じた回帰は
// 結末の要約を頭に添える。現在進行中の回帰はサーバがメモリの現周ログを返す。
import { useEffect, useState } from "react";
import type { Chronicle, TickResult } from "../../domain/types.ts";
import { FrontStage } from "../components/FrontStage.tsx";
import { skillName } from "../util.ts";
import { useDomainNames, useLang, useT } from "../i18n.tsx";

export function LoopPage({
  loop,
  chronicle,
}: {
  loop: number;
  chronicle: Chronicle | null;
}) {
  const t = useT();
  const dn = useDomainNames();
  const { lang } = useLang();
  const sep = lang === "en" ? ", " : "・";
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
        <a className="back-link" href="#/loops">
          {t("back_loops")}
        </a>
        <h2 className="page-title">
          {t("loop_label", { n: loop })}
          {live && <span className="loop-badge live">{t("loops_live")}</span>}
        </h2>
      </div>

      {sum && (
        <div className="loop-summary">
          <span className="loop-summary-end">{sum.causeOfEnd}</span>
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
                  .join(sep),
              })}
            </span>
          )}
        </div>
      )}

      {error ? (
        <p className="page-empty">{t("load_failed", { error })}</p>
      ) : ticks === null ? (
        <p className="page-empty">{t("loading")}</p>
      ) : ticks.length === 0 ? (
        <p className="page-empty">{t("loop_no_record")}</p>
      ) : (
        <FrontStage log={ticks} chronicle={chronicle} />
      )}
    </div>
  );
}
