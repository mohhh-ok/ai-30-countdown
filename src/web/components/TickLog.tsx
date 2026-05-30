// ティックログ（plan.md 第10節の出力フォーマット相当をカード化）
import type { TickResult } from "../../domain/types.ts";

export function TickLog({ log }: { log: TickResult[] }) {
  if (log.length === 0) {
    return <p className="log-empty">まだ何も起きていない。「次の1日」を押して始めましょう。</p>;
  }
  // 新しい順
  const items = [...log].reverse();
  return (
    <div className="log">
      {items.map((t) => (
        <div key={t.day} className="log-tick">
          <div className="log-day">
            Day {t.day}
            <span className={`weather weather-${t.weather}`}>
              {t.weather === "normal" ? "通常" : "不作"}
            </span>
          </div>
          {t.spotlightName && (
            <div className="spotlight-line">
              <span className="cam">🎥</span>
              今日の主役: <strong>{t.spotlightName}</strong>
              {t.spotlightReason && (
                <span className="spotlight-reason">— {t.spotlightReason}</span>
              )}
            </div>
          )}
          {t.director?.narration && (
            <div className="narration">
              <span className="clap">🎬</span>
              <span className="narration-text">{t.director.narration}</span>
              <span className="narration-intent" title={t.director.intent}>
                演出: {t.director.intent}
                {t.director.forageBoosts.length > 0 &&
                  `（実り操作 ${t.director.forageBoosts
                    .map((b) => `${b.delta >= 0 ? "+" : ""}${b.delta}`)
                    .join("/")}）`}
              </span>
            </div>
          )}
          {t.whispers && t.whispers.length > 0 && (
            <div className="whispers">
              {t.whispers.map((w, i) => {
                const name =
                  t.characters.find((c) => c.id === w.id)?.name ?? w.id;
                return (
                  <div key={i} className="whisper">
                    <span className="dove">🕊️</span>
                    <span className="whisper-to">守護神→{name}</span>
                    <span className="whisper-text">「{w.whisper}」</span>
                  </div>
                );
              })}
            </div>
          )}
          {t.characters.map((c) => (
            <div key={c.id} className="log-line">
              <span className="log-name">{c.name}</span>
              <span className="log-action">
                {c.moved && c.fromPlaceName
                  ? `${c.fromPlaceName}→${c.placeName}へ移動`
                  : c.actionLabel}
                {c.targetName && (
                  <span className="log-target">→ {c.targetName}</span>
                )}
                {c.impulse && <span className="impulse-tag">衝動</span>}
              </span>
              <span className="log-place">＠{c.placeName}</span>
              <span className="log-energy">
                {c.energyBefore}→{c.energyAfter}
                <span className={c.energyDelta >= 0 ? "delta up" : "delta down"}>
                  {c.energyDelta >= 0 ? `+${c.energyDelta}` : c.energyDelta}
                </span>
              </span>
              {c.diary && <span className="log-diary">「{c.diary}」</span>}
              {c.stageChanged && (
                <span className="log-stage">
                  段階: {c.stageBefore}→{c.stageAfter}
                </span>
              )}
              {c.died && <span className="log-died">力尽きた</span>}
            </div>
          ))}
          {t.dialogue && t.dialogue.length > 0 && (
            <div className="dialogue">
              {t.dialogue.map((line, i) => (
                <div
                  key={i}
                  className={`bubble bubble-${line.speakerId}`}
                >
                  <span className="speaker">{line.speakerName}</span>
                  <span className="bubble-text">{line.text}</span>
                </div>
              ))}
            </div>
          )}
          <div className="log-notable">注目の変化: {t.notable}</div>
        </div>
      ))}
    </div>
  );
}
