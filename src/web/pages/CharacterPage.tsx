// キャラ別ページ（全周横断）。重い TickResult ではなく char_metrics の薄い軌跡を
// /api/character/:id から取得し、そのキャラが登場した各回帰を、生存日数・利他のピーク・
// 結末つきの見出しで区切って、中に一行日記のタイムラインを並べる。
import { useEffect, useState } from "react";
import type { Chronicle, Talent } from "../../domain/types.ts";
import { createInitialCharacters } from "../../domain/characters.ts";
import { nameOfId, unlockOf } from "../util.ts";
import { useDomainNames, useT } from "../i18n.tsx";

/** /api/character/:id が返す char_metrics の1行（薄い軌跡）。 */
interface CharTrace {
  loop: number;
  day: number;
  place_name: string;
  diary: string;
  died: number;
  altruism: number;
  stage: string;
  frenzy_active: number;
  became_frenzied: number;
}

/** 1回帰ぶんのこのキャラの軌跡（見出し＋日記タイムライン）。 */
function LoopTrace({ loop, rows }: { loop: number; rows: CharTrace[] }) {
  const t = useT();
  const dn = useDomainNames();
  const peakAltruism = Math.max(...rows.map((r) => r.altruism));
  const died = rows.some((r) => r.died);
  const frenzied = rows.some((r) => r.became_frenzied);
  const last = rows[rows.length - 1];
  // 日記タイムラインは date desc（新しい日が上）。
  const daysDesc = [...rows].reverse();

  return (
    <section className="char-loop">
      <h3 className="char-loop-head">
        <a className="char-loop-num" href={`#/loop/${loop}`}>
          {t("loop_label", { n: loop })}
        </a>
        <span className="char-loop-meta">
          {t("char_loop_meta", {
            days: rows.length,
            peak: peakAltruism,
            stage: dn.stage(last.stage),
          })}
          {frenzied ? t("char_meta_frenzy") : ""}
          {died ? t("char_meta_died") : ""}
        </span>
      </h3>
      <ol className="char-days">
        {daysDesc.map((r) => (
          <li
            key={r.day}
            className={`char-day${r.died ? " char-day-died" : ""}`}
          >
            <span className="char-day-num">Day {r.day}</span>
            {/* char_metrics の trace は place_id を持たないため日本語地名のまま表示 */}
            <span className="char-day-place">＠{r.place_name}</span>
            {r.became_frenzied ? (
              <span className="char-day-frenzy">{t("char_day_transform")}</span>
            ) : r.frenzy_active ? (
              <span className="char-day-frenzy">{t("brief_frenzy")}</span>
            ) : null}
            {r.diary && <span className="char-day-diary">「{r.diary}」</span>}
            {r.died ? (
              <span className="char-day-end">{t("char_day_end")}</span>
            ) : null}
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
  const t = useT();
  const dn = useDomainNames();
  const talentLabel: Record<Talent, string> = {
    insight: t("talent_insight"),
    bond: t("talent_bond"),
    devour: t("talent_devour"),
    none: t("talent_none"),
  };
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
        if (alive) setError(e instanceof Error ? e.message : t("comm_error"));
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
            {t("back_home")}
          </a>
          <h2 className="page-title">
            🔒 ???
            <span className="loop-badge">{t("badge_locked")}</span>
          </h2>
        </div>
        <p className="page-empty">{t("locked_empty")}</p>
        <section className="unlock-card">
          <h3>{t("unlock_cond")}</h3>
          {unlock ? (
            <>
              {/* TODO(i18n): 解放条件の文言はドメイン定義の日本語固定文（issue #8 で翻訳予定） */}
              <p className="unlock-req">{unlock.requirement}</p>
              <p className="unlock-hint">{unlock.describe}</p>
            </>
          ) : (
            <p className="unlock-req">{t("unlock_unknown")}</p>
          )}
          <p className="unlock-now">
            {t("unlock_now", {
              loop: chronicle?.loop ?? 1,
              skills: chronicle?.skills.acquired.length ?? 0,
              peak: chronicle?.heroPeakAltruism ?? 0,
            })}
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
          {t("back_home")}
        </a>
        <h2 className="page-title">
          {def ? dn.char(def.id, def.name) : nameOfId(id)}
          {isHero && <span className="loop-badge">{t("badge_hero")}</span>}
        </h2>
      </div>

      {def && (
        <div className="char-profile">
          <img
            className="char-portrait"
            src={`/assets/characters/${def.id}.webp`}
            alt={dn.char(def.id, def.name)}
            loading="lazy"
            onError={(e) => {
              // まだ絵を生成していないキャラでは枠ごと隠す
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="char-profile-text">
            {/* TODO(i18n): core と initialLesson はドメイン定義の日本語固定文（issue #8 で翻訳予定） */}
            <p className="char-core">{def.core}</p>
            <p className="char-traits">
              <span>{t("char_talent", { label: talentLabel[def.talent] })}</span>
              <span>{t("char_lesson", { lesson: def.initialLesson })}</span>
            </p>
          </div>
        </div>
      )}

      {error ? (
        <p className="page-empty">{t("load_failed", { error })}</p>
      ) : sections.length === 0 ? (
        <p className="page-empty">{t("char_not_appeared")}</p>
      ) : (
        sections.map((s) => (
          <LoopTrace key={s.loop} loop={s.loop} rows={s.rows} />
        ))
      )}
    </div>
  );
}
