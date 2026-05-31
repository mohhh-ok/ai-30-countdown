// 表（観客）ビュー。数値や仕掛け（報酬・抗体・気分・囁き・演出意図）は見せず、
// 物語として楽しめる「主役の視点」だけを舞台化する。配信で眺める用。
// 最新の場面を大きく、過去の場面も同じ「シーン」として全部読める（留守でも遡れる）。
import type {
  CharacterTickResult,
  Chronicle,
  TickResult,
  WorldState,
} from "../../domain/types.ts";
import type { CSSProperties } from "react";
import { charColor } from "../charTheme.ts";
import { CharAvatar } from "./CharAvatar.tsx";

const WEATHER_WORD: Record<string, string> = {
  normal: "穏やかな日",
  lean: "実りの薄い日",
};

/** 回帰の節目（スキル会得・キャラ解放・巻き戻り）を物語の言葉で添える */
function SceneMarks({ t }: { t: TickResult }) {
  if (!t.acquiredSkills?.length && !t.unlockedCharacters?.length && !t.regressed) {
    return null;
  }
  return (
    <div className="scene-marks">
      {t.acquiredSkills?.length ? (
        <span className="mark mark-skill">
          ✨ ハルは「{t.acquiredSkills.join("」「")}」を会得した
        </span>
      ) : null}
      {t.unlockedCharacters?.length ? (
        <span className="mark mark-unlock">
          🆕 {t.unlockedCharacters.join("・")} が次の回帰から京に現れる
        </span>
      ) : null}
      {t.regressed ? (
        <span className="mark mark-regress">↻ ハルは力尽き、時は巻き戻る——</span>
      ) : null}
    </div>
  );
}

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
  if (c.moved)
    return c.action === "follow" && c.targetName
      ? `${c.name}は${c.targetName}を慕って${c.placeName}へ近づいた`
      : `${c.name}は${c.fromPlaceName}から${c.placeName}へ移ろった`;
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
    case "follow":
      return c.targetName
        ? `${c.name}は${c.targetName}の傍に寄り添った`
        : `${c.name}は寄り添う相手を探した`;
    case "purify":
      return (c.purifyCleansed ?? 1) > 0
        ? `${c.name}は${c.placeName}の濁りを祓い清めた`
        : `${c.name}は${c.placeName}で静かに祈った`;
    case "guard":
      return c.targetName
        ? `${c.name}は${c.targetName}を庇い守った`
        : `${c.name}は身構えて守ろうとした`;
    case "threaten":
      return c.targetName
        ? `${c.name}は${c.targetName}を脅して退けた`
        : `${c.name}は気を荒らげた`;
    default:
      return `${c.name}はその日を過ごした`;
  }
}

/** 早回し用の短い行為ラベル（名前は別に出すので動詞句だけ） */
function briefAct(c: CharacterTickResult): string {
  if (c.died) return "力尽きた…";
  if (c.moved)
    return c.action === "follow" && c.targetName
      ? `${c.targetName}を追って${c.placeName}へ`
      : `${c.placeName}へ`;
  switch (c.action) {
    case "forage":
      return c.forageDraw?.taboo ? "禁忌の業" : "霊を集めた";
    case "rest":
      return "気を鎮めた";
    case "talk":
      return c.targetName ? `${c.targetName}に語りかけ` : "ひとり言ちた";
    case "share":
      return c.targetName ? `${c.targetName}に分けた` : "分けようとした";
    case "steal":
      return c.targetName ? `${c.targetName}から奪った` : "奪った";
    case "deceive":
      return c.targetName ? `${c.targetName}を欺いた` : "欺いた";
    case "follow":
      return c.targetName ? `${c.targetName}に寄り添い` : "寄り添う相手を探し";
    case "purify":
      return (c.purifyCleansed ?? 1) > 0 ? "濁りを祓い清めた" : "静かに祈った";
    case "guard":
      return c.targetName ? `${c.targetName}を庇い` : "守ろうとした";
    case "threaten":
      return c.targetName ? `${c.targetName}を脅し退け` : "気を荒らげた";
    default:
      return "日を過ごした";
  }
}

/**
 * 早回し（montage）の1日。1行で淡々と流す。
 * 数値は見せないが、霊力が細った者にはそっと気配を添え、生存のヒリつきだけは残す。
 */
function MontageLine({ t }: { t: TickResult }) {
  return (
    <div className="montage-line">
      <span className="montage-day">第 {t.day} 日</span>
      <span className="montage-weather">{WEATHER_WORD[t.weather] ?? ""}</span>
      <span className="montage-acts">
        {t.characters.map((c) => {
          const low = !c.died && c.energyAfter <= 25;
          return (
            <span key={c.id} className={`montage-act${low ? " montage-low" : ""}`}>
              <span className="montage-act-name">{c.name}</span>
              {briefAct(c)}
              {low && <span className="montage-warn">…{vigorWord(c.energyAfter)}</span>}
            </span>
          );
        })}
      </span>
      <SceneMarks t={t} />
    </div>
  );
}

/** 1日ぶんの「場面」。primary=最新の場面は大きく、過去はやや控えめに。 */
function Scene({ t, primary }: { t: TickResult; primary: boolean }) {
  const hero = t.characters.find((c) => c.id === t.spotlightId);
  const others = t.characters.filter((c) => c.id !== t.spotlightId);

  return (
    <div className={`scene${primary ? "" : " scene-past"}`}>
      <div className="scene-head">
        {t.loop != null && <span className="scene-loop">第 {t.loop} 回帰</span>}
        <span className="scene-day">第 {t.day} 日</span>
        <span className="scene-weather">{WEATHER_WORD[t.weather] ?? ""}</span>
      </div>

      <SceneMarks t={t} />

      {t.director?.narration && (
        <p className="scene-narration">{t.director.narration}</p>
      )}

      {hero &&
        (primary ? (
          <div className={`hero${hero.died ? " hero-dead" : ""}`}>
            <CharAvatar
              id={hero.id}
              name={hero.name}
              size={120}
              square
              className="hero-portrait"
            />
            <div className="hero-body">
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
          {t.dialogue.map((line, i) => {
            // 主役（spotlight）は右、相手は左に寄せる。顔も外側へミラーする。
            // 古いログで spotlightId 未設定なら undefined 同士の誤一致を避け、全員左に倒す。
            const isHero = !!t.spotlightId && line.speakerId === t.spotlightId;
            // 色は「誰の声か」をキャラ別に。クラス直書きをやめ map から CSS 変数で流す。
            const col = charColor(line.speakerId);
            return (
              <div
                key={i}
                className={`stage-bubble ${isHero ? "bubble-right" : "bubble-left"}`}
                style={
                  {
                    "--bubble-bg": col.bg,
                    "--bubble-fg": col.fg,
                  } as CSSProperties
                }
              >
                <span className="stage-speaker">
                  <CharAvatar id={line.speakerId} name={line.speakerName} size={42} />
                  {line.speakerName}
                </span>
                <span className="stage-bubble-text">{line.text}</span>
              </div>
            );
          })}
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
  chronicle,
}: {
  state?: WorldState | null; // ライブな世界（ホームのみ）。過去回帰ページでは無し＝「京の気」を出さない。
  log: TickResult[];
  chronicle?: Chronicle | null;
}) {
  if (log.length === 0) {
    const solo = chronicle && chronicle.roster.length <= 1;
    return (
      <div className="stage-empty">
        <p>幕が上がるのを待っています。</p>
        <p className="stage-empty-sub">
          {solo
            ? "第一の回帰——京にはまだハルひとり。「次の1日 ▶」で物語を始めましょう。"
            : "「次の1日 ▶」で物語を始めましょう。"}
        </p>
      </div>
    );
  }

  const latest = log[log.length - 1];
  const past = log.slice(0, -1).reverse(); // 過去（新しい順）

  return (
    <div className="stage">
      {/* いちばん新しい1日を主役の場面として大きく見せる */}
      <Scene t={latest} primary />

      {/* 京の気 — 各霊地に残る民の霊力（清/濁）。枯れゆく京を体感する。ライブな世界のときだけ。 */}
      {state && (
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
      )}

      {/* これまでの物語（新しい順）。早回しの日は1行で流し、見せ場の日だけ場面として開く。 */}
      {past.length > 0 && (
        <div className="story-feed">
          <h3 className="story-title">これまでの物語</h3>
          {past.map((t, i) =>
            // tempo 無し（旧データ）は場面扱いで後方互換。回帰で day が重複するので複合キー。
            t.tempo === "montage" ? (
              <MontageLine key={`${t.loop ?? 1}-${t.day}-${i}`} t={t} />
            ) : (
              <Scene key={`${t.loop ?? 1}-${t.day}-${i}`} t={t} primary={false} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
