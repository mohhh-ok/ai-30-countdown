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
import { useState } from "react";
import { charColor } from "../charTheme.ts";
import { CharAvatar } from "./CharAvatar.tsx";
import { SceneFX } from "./SceneFX.tsx";
import {
  useDiary,
  useDomainNames,
  useFrenzyNarration,
  useLocalized,
  useSep,
  useStory,
  useT,
} from "../i18n.tsx";

/** 主役枠の地に敷く「今いる場所」の背景絵。object-fit でフィットさせ、未生成(404)なら消えて地色に落ちる。 */
function HeroBackground({ placeId, placeName }: { placeId?: string; placeName?: string }) {
  const [failed, setFailed] = useState(false);
  if (!placeId || failed) return null;
  return (
    <img
      className="hero-bg"
      src={`/assets/places/${placeId}.webp`}
      alt={placeName ?? ""}
      aria-hidden
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** 回帰の節目（スキル会得・キャラ解放・巻き戻り）を物語の言葉で添える */
function SceneMarks({ t }: { t: TickResult }) {
  const tr = useT();
  const dn = useDomainNames();
  const sep = useSep();
  const becamer = t.characters.find((c) => c.becameFrenzied);
  const queller = t.characters.find((c) => c.quelledFrenzy);
  const wild = t.characters.find((c) => c.frenzyLevel !== undefined);
  if (
    !t.acquiredSkills?.length &&
    !t.unlockedCharacters?.length &&
    !t.regressed &&
    !t.climax &&
    !becamer &&
    !queller
  ) {
    return null;
  }
  // 表示名（日本語）で載るので id へ逆引きしてから言語別に解決（dn.*ByName）。区切りも言語で変える。
  const skillsStr = t.acquiredSkills?.map(dn.skillByName).join(sep.skills);
  const unlockStr = t.unlockedCharacters?.map(dn.charByName).join(sep.list);
  return (
    <div className="scene-marks">
      {t.climax ? (
        <span className={`mark mark-climax${t.climax.averted ? " mark-climax-saved" : ""}`}>
          {tr(t.climax.averted ? "mark_climax_saved" : "mark_climax_lost")}
        </span>
      ) : null}
      {becamer ? (
        <span className="mark mark-frenzy">
          {tr("mark_frenzy", { name: dn.char(becamer.id, becamer.name) })}
        </span>
      ) : null}
      {queller ? (
        <span className="mark mark-quell">
          {tr("mark_quell", {
            wild: wild
              ? tr("mark_quell_wild", { name: dn.char(wild.id, wild.name) })
              : tr("mark_quell_someone"),
          })}
        </span>
      ) : null}
      {t.acquiredSkills?.length ? (
        <span className="mark mark-skill">
          {tr("mark_skill", { skills: skillsStr ?? "" })}
        </span>
      ) : null}
      {t.unlockedCharacters?.length ? (
        <span className="mark mark-unlock">
          {tr("mark_unlock", { names: unlockStr ?? "" })}
        </span>
      ) : null}
      {t.regressed ? (
        <span className="mark mark-regress">{tr("mark_regress")}</span>
      ) : null}
    </div>
  );
}

/**
 * 早回し（montage）の1日。1行で淡々と流す。
 * 数値は見せないが、霊力が細った者にはそっと気配を添え、生存のヒリつきだけは残す。
 */
function MontageLine({ t }: { t: TickResult }) {
  const tr = useT();
  const dn = useDomainNames();
  const story = useStory();
  return (
    <div className="montage-line">
      <span className="montage-day">{tr("scene_day", { n: t.day })}</span>
      <span className="montage-weather">{story.weatherWord(t.weather)}</span>
      <span className="montage-acts">
        {t.characters.map((c) => {
          const low = !c.died && c.energyAfter <= 25;
          return (
            <span key={c.id} className={`montage-act${low ? " montage-low" : ""}`}>
              <span className="montage-act-name">{dn.char(c.id, c.name)}</span>
              {story.briefAct(c)}
              {!c.died && c.frenzyActive && !c.becameFrenzied && (
                <span className="montage-frenzy">{tr("brief_frenzy")}</span>
              )}
              {low && (
                <span className="montage-warn">
                  {tr("montage_low_sep")}
                  {story.vigor(c.energyAfter)}
                </span>
              )}
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
  const tr = useT();
  const dn = useDomainNames();
  const story = useStory();
  const loc = useLocalized();
  const frenzyNarration = useFrenzyNarration();
  const diary = useDiary();
  const hero = t.characters.find((c) => c.id === t.spotlightId);
  const others = t.characters.filter((c) => c.id !== t.spotlightId);
  // LLM のナレーション（言語別）＋当日の変身・鎮静の地の文（決定的ルール文）。
  const narration = [loc(t.director?.narration, "narration"), frenzyNarration(t.characters)]
    .filter(Boolean)
    .join("\n");

  return (
    <div className={`scene${primary ? "" : " scene-past"}`}>
      <div className="scene-head">
        {t.loop != null && (
          <span className="scene-loop">{tr("loop_label", { n: t.loop })}</span>
        )}
        <span className="scene-day">{tr("scene_day", { n: t.day })}</span>
        <span className="scene-weather">{story.weatherWord(t.weather)}</span>
      </div>

      <SceneMarks t={t} />

      {narration && <p className="scene-narration">{narration}</p>}

      {hero &&
        (primary ? (
          <div className={`hero${hero.died ? " hero-dead" : ""}`}>
            <HeroBackground
              key={hero.placeId}
              placeId={hero.placeId}
              placeName={hero.placeName}
            />
            {/* 背景絵の上に「霊気」の粒子を漂わせる演出レイヤ。場所が変われば key で作り直す。 */}
            <SceneFX key={`fx-${hero.placeId ?? "none"}`} tone={hero.died ? "cool" : "warm"} />
            <CharAvatar
              id={hero.id}
              name={dn.char(hero.id, hero.name)}
              size={120}
              square
              className="hero-portrait"
            />
            <div className="hero-body">
              <div className="hero-top">
                <span className="hero-cam">🎥</span>
                <span className="hero-name">{dn.char(hero.id, hero.name)}</span>
                {!hero.died && (
                  <span className="hero-vigor">{story.vigor(hero.energyAfter)}</span>
                )}
                <span className="hero-place">
                  ＠{dn.place(hero.placeId, hero.placeName)}
                </span>
              </div>
              <p className="hero-act">{story.actStory(hero)}</p>
              {(() => {
                const dt = diary(hero.diary, hero.diaryNote);
                return dt ? <p className="hero-diary">「{dt}」</p> : null;
              })()}
            </div>
          </div>
        ) : (
          <div className={`hero-line${hero.died ? " hero-dead" : ""}`}>
            <span className="hero-cam">🎥</span>
            <span className="hero-line-name">{dn.char(hero.id, hero.name)}</span>
            <span className="hero-line-act">{story.actStory(hero)}</span>
            {(() => {
              const dt = diary(hero.diary, hero.diaryNote);
              return dt ? <span className="hero-line-diary">「{dt}」</span> : null;
            })()}
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
                  <CharAvatar
                    id={line.speakerId}
                    name={dn.char(line.speakerId, line.speakerName)}
                    size={42}
                  />
                  {dn.char(line.speakerId, line.speakerName)}
                </span>
                <span className="stage-bubble-text">{loc(line.text, "dialogue")}</span>
              </div>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <div className="scene-others">
          <span className="others-label">{tr("others_label")}</span>
          {others.map((c) => (
            <span key={c.id} className="other-line">
              {story.actStory(c)}
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
  const tr = useT();
  const dn = useDomainNames();
  if (log.length === 0) {
    const solo = chronicle && chronicle.roster.length <= 1;
    return (
      <div className="stage-empty">
        <p>{tr("stage_empty")}</p>
        <p className="stage-empty-sub">
          {solo ? tr("stage_empty_solo") : tr("stage_empty_sub")}
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

      {/* 京の気 — 各霊地に残る民の霊力（和み＝sei／荒び＝daku）。枯れゆく京を体感する。ライブな世界のときだけ。
          全霊地で器を共有スケール化し（自地の天井で割ると皆ほぼ満タン＝同じに見えてしまう）、
          上＝和み・下＝荒びの2本バーで「地の性格（器の長さ）」と「枯れ具合（塗りの長さ）」を同時に見せる。 */}
      {state && (
      <div className="kyo-gauge">
        <div className="kyo-head">
          <span className="kyo-title">{tr("kyo_title")}</span>
          <span className="kyo-legend">
            <span className="kyo-leg"><i className="kyo-dot kyo-dot-sei" />{tr("kyo_sei")}</span>
            <span className="kyo-leg"><i className="kyo-dot kyo-dot-daku" />{tr("kyo_daku")}</span>
          </span>
        </div>
        <div className="kyo-places">
          {(() => {
            // 全霊地の器の最大値を共有スケールに。これで地ごとの器の大小（＝性格）が長さで読める。
            const scale = Math.max(
              1,
              ...state.places.flatMap((p) => [p.populaceMax.sei, p.populaceMax.daku]),
            );
            return state.places.map((p) => {
              const seiVessel = (p.populaceMax.sei / scale) * 100; // 器（和み）の大きさ＝地の性格
              const dakuVessel = (p.populaceMax.daku / scale) * 100; // 器（荒び）の大きさ
              const seiFill = (p.populace.sei / Math.max(1, p.populaceMax.sei)) * 100; // 枯れ具合
              const dakuFill = (p.populace.daku / Math.max(1, p.populaceMax.daku)) * 100;
              return (
                <div key={p.id} className="kyo-place">
                  <span className="kyo-name">{dn.place(p.id, p.name)}</span>
                  <div className="kyo-bars">
                    <div className="kyo-bar">
                      <div className="kyo-vessel kyo-vessel-sei" style={{ width: `${seiVessel}%` }}>
                        <div className="kyo-fill kyo-sei" style={{ width: `${seiFill}%` }} />
                      </div>
                    </div>
                    <div className="kyo-bar">
                      <div className="kyo-vessel kyo-vessel-daku" style={{ width: `${dakuVessel}%` }}>
                        <div className="kyo-fill kyo-daku" style={{ width: `${dakuFill}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>
      )}

      {/* これまでの物語（新しい順）。早回しの日は1行で流し、見せ場の日だけ場面として開く。 */}
      {past.length > 0 && (
        <div className="story-feed">
          <h3 className="story-title">{tr("story_title")}</h3>
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
