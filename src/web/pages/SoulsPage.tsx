// ココロ一覧ページ。他者から「された経験」で芽生える内面の傾き（多種類）を、
// (1) 心の種類カタログ（どの経験で・何回で・どの段階か）と、
// (2) いま登場している各妖の現状（心ごとの受領回数・段階・進捗）で見せる。
// 会得式スキル（ハル専用の永続パッシブ）とは別系統。持ち越せるのはハルだけ。
import type { Character, Chronicle } from "../../domain/types.ts";
import { SOUL_KINDS, type SoulKind, soulStageOf } from "../../domain/soul.ts";
import { CharAvatar } from "../components/CharAvatar.tsx";

function maxThreshold(kind: SoulKind): number {
  return kind.stages[kind.stages.length - 1].threshold;
}

/** 心の種類カタログ（定義）カード。芽生える経験と段階の道のりを示す。 */
function KindCatalogCard({ kind }: { kind: SoulKind }) {
  return (
    <section className="skill-card">
      <div className="skill-card-head">
        <span className="skill-card-title">
          <span className="skill-card-icon" aria-hidden="true">
            {kind.icon}
          </span>
          <span className="skill-card-name">{kind.label}</span>
        </span>
      </div>
      <p className="skill-card-desc">{kind.source}が積もると芽生える。</p>
      <div className="mt-1 text-sm opacity-80">
        {kind.stages.map((s) => `${s.label}（${s.threshold}回〜）`).join(" → ")}
      </div>
    </section>
  );
}

/** 1妖の全種類のココロの現状。心ごとに段階ラベル・進捗バー・受領回数を並べる。 */
function CharSoulCard({ char, isHero }: { char: Character; isHero: boolean }) {
  const anyAwakened = SOUL_KINDS.some((k) => soulStageOf(k, char.soulCounters[k.id] ?? 0));
  return (
    <section className={`skill-card${anyAwakened ? " skill-acquired" : ""}`}>
      <div className="skill-card-head">
        <span className="skill-card-title">
          <CharAvatar id={char.id} name={char.name} size={28} />
          <span className="skill-card-name">{char.name}</span>
        </span>
        <span className={`skill-scope skill-scope-${isHero ? "career" : "loop"}`}>
          {isHero ? "通算" : "今周"}
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
                {k.icon} {k.label}
              </span>
              <div className="skill-bar flex-1">
                <div className="skill-bar-fill" style={{ width: `${ratio * 100}%` }} />
              </div>
              <span className="skill-progress-num shrink-0" style={{ minWidth: "5.5rem" }}>
                {stage ? `${stage.label}・` : ""}
                {count}回
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
  const heroId = chronicle?.protagonistId ?? "haru";

  return (
    <div className="page">
      <div className="page-head">
        <a className="back-link" href="#/">
          ← ホーム
        </a>
        <h2 className="page-title">💞 ココロ</h2>
      </div>

      <p className="skill-lead">
        霊力を分けてもらう（share を受ける）経験が積もると、妖の内面に「利他の心」が芽生えます。芽生えた心は
        本人の判断材料に加わり、分け与え・語らい・寄り添いといった行動へ傾けます。会得式スキルとは別の仕組みで
        全キャラが持ちますが、回帰をまたいで持ち越せるのは主人公ハルだけです（他の妖は周ごとにまっさらへ戻ります）。
      </p>

      <h3 style={{ marginTop: "1.75rem", marginBottom: "0.5rem" }}>ココロの種類</h3>
      <div className="skill-grid">
        {SOUL_KINDS.map((k) => (
          <KindCatalogCard key={k.id} kind={k} />
        ))}
      </div>

      <h3 style={{ marginTop: "1.75rem", marginBottom: "0.5rem" }}>いまの各々のココロ</h3>
      {characters.length === 0 ? (
        <p className="skill-lead">まだ誰も登場していません。</p>
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
