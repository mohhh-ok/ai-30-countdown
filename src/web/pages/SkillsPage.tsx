// スキル一覧ページ。獲得式スキル（回帰をまたいで永続する唯一のもの）を全件並べ、
// 習得条件・効果・スコープと、現在のハルの進捗（chronicle.skills）を見せる。
import type { Chronicle, SkillDef } from "../../domain/types.ts";
import { SKILLS } from "../../domain/skills.ts";
import { useDomainNames, useT } from "../i18n.tsx";

/** 1スキルのカード。習得済みなら強調し、未習得なら進捗バーを出す。 */
function SkillCard({
  skill,
  acquired,
  progress,
}: {
  skill: SkillDef;
  acquired: boolean;
  progress: number;
}) {
  const t = useT();
  const dn = useDomainNames();
  const scopeLabel = skill.scope === "career" ? t("scope_career") : t("scope_loop");
  const ratio = Math.min(1, progress / skill.threshold);
  return (
    <section className={`skill-card${acquired ? " skill-acquired" : ""}`}>
      <div className="skill-card-head">
        <span className="skill-card-title">
          <span className="skill-card-icon" aria-hidden="true">
            {skill.icon}
          </span>
          <span className="skill-card-name">
            {acquired ? "✨ " : ""}
            {dn.skill(skill.id, skill.name)}
          </span>
        </span>
        <span className={`skill-scope skill-scope-${skill.scope}`}>
          {scopeLabel}
        </span>
      </div>
      <p className="skill-card-desc">{dn.skillDesc(skill.id, skill.description)}</p>
      <div className="skill-progress">
        {acquired ? (
          <span className="skill-progress-done">{t("skill_done")}</span>
        ) : (
          <>
            <div className="skill-bar">
              <div className="skill-bar-fill" style={{ width: `${ratio * 100}%` }} />
            </div>
            <span className="skill-progress-num">
              {progress} / {skill.threshold}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

export function SkillsPage({ chronicle }: { chronicle: Chronicle | null }) {
  const t = useT();
  const prof = chronicle?.skills;
  // 隠しスキル（secret: 暁の迎え火）は会得の瞬間まで存在ごと伏せる（総数 n/total にも数えない）。
  const visible = SKILLS.filter(
    (s) => !s.secret || (prof?.acquired.includes(s.id) ?? false),
  );
  // 廃止スキル（旧 share_taste 等）の会得が古い run に残っていても件数を膨らませない。
  const acquiredCount = visible.filter((s) => prof?.acquired.includes(s.id)).length;

  return (
    <div className="page">
      <div className="page-head">
        <a className="back-link" href="#/">
          {t("back_home")}
        </a>
        <h2 className="page-title">
          {t("skills_title")}
          <span className="loop-badge">
            {t("skills_count", { n: acquiredCount, total: visible.length })}
          </span>
        </h2>
      </div>

      <p className="skill-lead">{t("skills_lead")}</p>

      <div className="skill-grid">
        {visible.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            acquired={prof?.acquired.includes(skill.id) ?? false}
            progress={prof?.progress[skill.id] ?? 0}
          />
        ))}
      </div>
    </div>
  );
}
