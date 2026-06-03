// ココロ一覧ページ。他者から「された経験」で芽生える内面の傾き（多種類）を、
// (1) 心の種類カタログ（どの経験で・何回で・どの段階か）と、
// (2) いま登場している各妖の現状（心ごとの受領回数・段階・進捗）で見せる。
// 会得式スキル（ハル専用の永続パッシブ）とは別系統。持ち越せるのはハルだけ。
import type { Character, Chronicle } from "../../domain/types.ts";
import { SOUL_KINDS, type SoulKind, soulStageOf } from "../../domain/soul.ts";
import { CharAvatar } from "../components/CharAvatar.tsx";
import { useDomainNames, useT } from "../i18n.tsx";

function maxThreshold(kind: SoulKind): number {
  return kind.stages[kind.stages.length - 1].threshold;
}

/** 心の種類カタログ（定義）カード。芽生える経験と段階の道のりを示す。 */
function KindCatalogCard({ kind }: { kind: SoulKind }) {
  const t = useT();
  const dn = useDomainNames();
  return (
    <section className="skill-card">
      <div className="skill-card-head">
        <span className="skill-card-title">
          <span className="skill-card-icon" aria-hidden="true">
            {kind.icon}
          </span>
          <span className="skill-card-name">{dn.soulKind(kind.id, kind.label)}</span>
        </span>
      </div>
      <p className="skill-card-desc">
        {t("souls_kind_desc", { source: dn.soulSource(kind.id, kind.source) })}
      </p>
      <div className="mt-1 text-sm opacity-80">
        {kind.stages
          .map((s) =>
            t("souls_stage_item", { label: dn.soulStage(s.label), n: s.threshold }),
          )
          .join(" → ")}
      </div>
    </section>
  );
}

/** 1妖の全種類のココロの現状。心ごとに段階ラベル・進捗バー・受領回数を並べる。 */
function CharSoulCard({ char, isHero }: { char: Character; isHero: boolean }) {
  const t = useT();
  const dn = useDomainNames();
  const anyAwakened = SOUL_KINDS.some((k) => soulStageOf(k, char.soulCounters[k.id] ?? 0));
  return (
    <section className={`skill-card${anyAwakened ? " skill-acquired" : ""}`}>
      <div className="skill-card-head">
        <span className="skill-card-title">
          <CharAvatar id={char.id} name={dn.char(char.id, char.name)} size={28} />
          <span className="skill-card-name">{dn.char(char.id, char.name)}</span>
        </span>
        <span className={`skill-scope skill-scope-${isHero ? "career" : "loop"}`}>
          {isHero ? t("scope_career") : t("souls_scope_now")}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {SOUL_KINDS.map((k) => {
          const count = char.soulCounters[k.id] ?? 0;
          const stage = soulStageOf(k, count);
          const ratio = Math.min(1, count / maxThreshold(k));
          return (
            <div key={k.id} className="flex items-center gap-2">
              <span className="text-sm shrink-0" style={{ minWidth: "6.5rem" }}>
                {k.icon} {dn.soulKind(k.id, k.label)}
              </span>
              <div className="skill-bar flex-1">
                <div className="skill-bar-fill" style={{ width: `${ratio * 100}%` }} />
              </div>
              <span className="skill-progress-num shrink-0" style={{ minWidth: "5.5rem" }}>
                {stage ? t("souls_stage_prefix", { label: dn.soulStage(stage.label) }) : ""}
                {t("souls_count_times", { n: count })}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SoulsPage({
  characters,
  chronicle,
}: {
  characters: Character[];
  chronicle: Chronicle | null;
}) {
  const t = useT();
  const heroId = chronicle?.protagonistId ?? "haru";

  return (
    <div className="page">
      <div className="page-head">
        <a className="back-link" href="#/">
          {t("back_home")}
        </a>
        <h2 className="page-title">{t("souls_title")}</h2>
      </div>

      <p className="skill-lead">{t("souls_lead")}</p>

      <h3 style={{ marginTop: "1.75rem", marginBottom: "0.5rem" }}>
        {t("souls_kinds_head")}
      </h3>
      <div className="skill-grid">
        {SOUL_KINDS.map((k) => (
          <KindCatalogCard key={k.id} kind={k} />
        ))}
      </div>

      <h3 style={{ marginTop: "1.75rem", marginBottom: "0.5rem" }}>
        {t("souls_now_head")}
      </h3>
      {characters.length === 0 ? (
        <p className="skill-lead">{t("souls_empty")}</p>
      ) : (
        <div className="skill-grid">
          {characters.map((c) => (
            <CharSoulCard key={c.id} char={c} isHero={c.id === heroId} />
          ))}
        </div>
      )}
    </div>
  );
}
