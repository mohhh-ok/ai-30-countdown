// スキル一覧ページ。獲得式スキル（回帰をまたいで永続する唯一のもの）を全件並べ、
// 習得条件・効果・スコープと、現在のハルの進捗（chronicle.skills）を見せる。
import type { Chronicle, SkillDef } from "../../domain/types.ts";
import { SKILLS } from "../../domain/skills.ts";

const SCOPE_LABEL: Record<SkillDef["scope"], string> = {
  loop: "周回内",
  career: "通算",
};

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
  const ratio = Math.min(1, progress / skill.threshold);
  return (
    <section className={`skill-card${acquired ? " skill-acquired" : ""}`}>
      <div className="skill-card-head">
        <span className="skill-card-name">
          {acquired ? "✨ " : ""}
          {skill.name}
        </span>
        <span className={`skill-scope skill-scope-${skill.scope}`}>
          {SCOPE_LABEL[skill.scope]}
        </span>
      </div>
      <p className="skill-card-desc">{skill.description}</p>
      <div className="skill-progress">
        {acquired ? (
          <span className="skill-progress-done">会得済み</span>
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
  const prof = chronicle?.skills;
  const acquiredCount = prof?.acquired.length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <a className="back-link" href="#/">
          ← ホーム
        </a>
        <h2 className="page-title">
          ✨ 会得式スキル
          <span className="loop-badge">
            {acquiredCount} / {SKILLS.length} 会得
          </span>
        </h2>
      </div>

      <p className="skill-lead">
        記憶も成長値も異能も回帰のたびにリセットされる中で、ここに並ぶスキルだけが
        周回をまたいで永続します。ハルが条件を満たした瞬間に会得し、以後は全周にわたって効き続けます。
      </p>

      <div className="skill-grid">
        {SKILLS.map((skill) => (
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
