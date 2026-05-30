// 表（観客）ビュー。数値や仕掛け（報酬・抗体・気分・囁き・演出意図）は見せず、
// 物語として楽しめる「主役の視点」だけを舞台化する。配信で眺める用。
// 最新の場面を大きく、過去の場面も同じ「シーン」として全部読める（留守でも遡れる）。
import type {
  CharacterTickResult,
  TickResult,
  WorldState,
} from "../../domain/types.ts";

const WEATHER_WORD: Record<string, string> = {
  normal: "穏やかな日",
  lean: "実りの薄い日",
};

/** エネルギーを観客向けのざっくりした言葉に（数値は見せない） */
function vigorWord(e: number): string {
  if (e <= 10) return "限界が近い";
  if (e <= 25) return "疲れている";
  if (e <= 55) return "落ち着いている";
  return "元気";
}

/** その日その人が「何をしたか」を物語の言葉にする */
function actStory(c: CharacterTickResult): string {
  if (c.died) return `${c.name}は、ここで消え去った…`;
  if (c.moved) return `${c.name}は${c.fromPlaceName}から${c.placeName}へ移ろった`;
  switch (c.action) {
    case "forage": {
      const dr = c.forageDraw;
      if (dr?.taboo) return `${c.name}は${c.placeName}で清き霊を喰らった——禁忌`;
      if (dr && dr.daku > 0 && dr.sei === 0) return `${c.name}は${c.placeName}で濁霊を喰らった`;
      if (dr && dr.gain === 0) return `${c.name}は霊を集めたが、この地は枯れていた`;
      return `${c.name}は${c.placeName}で霊を集めた`;
    }
    case "rest":
      return `${c.name}は静かに気を鎮めた`;
    case "talk":
      return c.targetName
        ? `${c.name}は${c.targetName}に語りかけた`
        : `${c.name}はひとり言ちた`;
    case "share":
      return c.targetName
        ? `${c.name}は${c.targetName}に霊力を分けた`
        : `${c.name}は霊力を分けようとした`;
    case "steal":
      return c.targetName
        ? `${c.name}は${c.targetName}から霊を奪った`
        : `${c.name}は霊を奪った`;
    case "deceive":
      return c.targetName
        ? `${c.name}は${c.targetName}を欺いた`
        : `${c.name}は欺いた`;
    default:
      return `${c.name}はその日を過ごした`;
  }
}

/** 1日ぶんの「場面」。primary=最新の場面は大きく、過去はやや控えめに。 */
function Scene({ t, primary }: { t: TickResult; primary: boolean }) {
  const hero = t.characters.find((c) => c.id === t.spotlightId);
  const others = t.characters.filter((c) => c.id !== t.spotlightId);

  return (
    <div className={`scene${primary ? "" : " scene-past"}`}>
      <div className="scene-head">
        <span className="scene-day">第 {t.day} 日</span>
        <span className="scene-weather">{WEATHER_WORD[t.weather] ?? ""}</span>
      </div>

      {t.director?.narration && (
        <p className="scene-narration">{t.director.narration}</p>
      )}

      {hero &&
        (primary ? (
          <div className={`hero${hero.died ? " hero-dead" : ""}`}>
            <div className="hero-top">
              <span className="hero-cam">🎥</span>
              <span className="hero-name">{hero.name}</span>
              {!hero.died && (
                <span className="hero-vigor">{vigorWord(hero.energyAfter)}</span>
              )}
              <span className="hero-place">＠{hero.placeName}</span>
            </div>
            <p className="hero-act">{actStory(hero)}</p>
            {hero.diary && <p className="hero-diary">「{hero.diary}」</p>}
          </div>
        ) : (
          <div className={`hero-line${hero.died ? " hero-dead" : ""}`}>
            <span className="hero-cam">🎥</span>
            <span className="hero-line-name">{hero.name}</span>
            <span className="hero-line-act">{actStory(hero)}</span>
            {hero.diary && <span className="hero-line-diary">「{hero.diary}」</span>}
          </div>
        ))}

      {t.dialogue && t.dialogue.length > 0 && (
        <div className="scene-dialogue">
          {t.dialogue.map((line, i) => (
            <div key={i} className={`stage-bubble bubble-${line.speakerId}`}>
              <span className="stage-speaker">{line.speakerName}</span>
              <span className="stage-bubble-text">{line.text}</span>
            </div>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="scene-others">
          <span className="others-label">その頃——</span>
          {others.map((c) => (
            <span key={c.id} className="other-line">
              {actStory(c)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function FrontStage({
  state,
  log,
}: {
  state: WorldState;
  log: TickResult[];
}) {
  if (log.length === 0) {
    return (
      <div className="stage-empty">
        <p>幕が上がるのを待っています。</p>
        <p className="stage-empty-sub">「次の1日 ▶」で物語を始めましょう。</p>
      </div>
    );
  }

  const latest = log[log.length - 1];
  const past = log.slice(0, -1).reverse(); // 過去（新しい順）

  return (
    <div className="stage">
      {/* いちばん新しい1日を主役の場面として大きく見せる */}
      <Scene t={latest} primary />

      {/* 京の気 — 各霊地に残る民の霊力（清/濁）。枯れゆく京を体感する。 */}
      <div className="kyo-gauge">
        <span className="kyo-title">⛩ 京の気</span>
        <div className="kyo-places">
          {state.places.map((p) => {
            const seiPct = Math.round((p.populace.sei / Math.max(1, p.populaceMax.sei)) * 100);
            const dakuPct = Math.round((p.populace.daku / Math.max(1, p.populaceMax.daku)) * 100);
            return (
              <div key={p.id} className="kyo-place">
                <span className="kyo-name">{p.name}</span>
                <div className="kyo-bars">
                  <div className="kyo-track" title={`清霊 ${p.populace.sei}`}>
                    <div className="kyo-fill kyo-sei" style={{ width: `${seiPct}%` }} />
                  </div>
                  <div className="kyo-track" title={`濁霊 ${p.populace.daku}`}>
                    <div className="kyo-fill kyo-daku" style={{ width: `${dakuPct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* これまでの物語（過去の場面を全部・新しい順に読める） */}
      {past.length > 0 && (
        <div className="story-feed">
          <h3 className="story-title">これまでの物語</h3>
          {past.map((t) => (
            <Scene key={t.day} t={t} primary={false} />
          ))}
        </div>
      )}

      {state.finished && (
        <div className="stage-finished">— この世界の物語は幕を閉じた —</div>
      )}
    </div>
  );
}
