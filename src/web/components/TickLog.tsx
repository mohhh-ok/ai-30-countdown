// ティックログ（plan.md 第10節の出力フォーマット相当をカード化）
import type { LlmCallTiming, TickResult } from "../../domain/types.ts";

/** ミリ秒を読みやすく（1秒以上は「1.2s」、未満は「840ms」）。 */
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** その日の LLM 呼び出し時間の内訳。種別（label の ":" 前）でまとめ、合計が大きい順に並べる。 */
function TimingBlock({ timings }: { timings: LlmCallTiming[] }) {
  if (!timings.length) return null;
  // 述べ時間（並列呼び出しは実時間では重なるので合計は上限の目安）。最長1件はボトルネック特定用。
  const totalMs = timings.reduce((s, t) => s + t.ms, 0);
  const slowest = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
  const fails = timings.filter((t) => !t.ok).length;

  // 種別ごとに集計（decide:haru / decide:nagi … は "decide" にまとめる）
  const groups = new Map<string, { count: number; sum: number; max: number }>();
  for (const t of timings) {
    const kind = t.label.split(":")[0];
    const g = groups.get(kind) ?? { count: 0, sum: 0, max: 0 };
    g.count += 1;
    g.sum += t.ms;
    g.max = Math.max(g.max, t.ms);
    groups.set(kind, g);
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].sum - a[1].sum);

  return (
    <div className="log-timing">
      <span className="timing-head">
        ⏱ LLM {timings.length}回 / 述べ {fmtMs(totalMs)}
        <span className="timing-slow">最長 {slowest.label} {fmtMs(slowest.ms)}</span>
        {fails > 0 && <span className="timing-fail">失敗{fails}（リトライ）</span>}
      </span>
      <span className="timing-groups">
        {rows.map(([kind, g]) => (
          <span key={kind} className="timing-group" title={`${g.count}回 / 最長 ${fmtMs(g.max)}`}>
            {kind} {fmtMs(g.sum)}
            <span className="timing-count">×{g.count}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

export function TickLog({ log }: { log: TickResult[] }) {
  if (log.length === 0) {
    return <p className="log-empty">まだ何も起きていない。「次の1日」を押して始めましょう。</p>;
  }
  // 新しい順
  const items = [...log].reverse();
  return (
    <div className="log">
      {items.map((t, i) => (
        // 回帰で day が周ごとに重複するので複合キー
        <div key={`${t.loop ?? 1}-${t.day}-${i}`} className="log-tick">
          <div className="log-day">
            {t.loop != null && <span className="log-loop">L{t.loop}</span>}
            Day {t.day}
            <span className={`weather weather-${t.weather}`}>
              {t.weather === "normal" ? "通常" : "不作"}
            </span>
            {t.worldEvents?.map((e) => {
              const dayNo = e.totalDays - e.remainingDays + 1;
              const isNew = t.newWorldEvents?.some((n) => n.kind === e.kind);
              return (
                <span
                  key={e.kind}
                  className={`world-event world-event-${e.kind}${isNew ? " world-event-new" : ""}`}
                  title={`${dayNo}日目 / 全${e.totalDays}日`}
                >
                  {e.icon} {e.name}
                  {isNew ? "（発生）" : `（${dayNo}/${e.totalDays}）`}
                </span>
              );
            })}
          </div>
          {(t.acquiredSkills?.length ||
            t.unlockedCharacters?.length ||
            t.regressed) && (
            <div className="log-marks">
              {t.acquiredSkills?.length ? (
                <span className="mark mark-skill">
                  ✨ ハル、「{t.acquiredSkills.join("」「")}」を会得
                </span>
              ) : null}
              {t.unlockedCharacters?.length ? (
                <span className="mark mark-unlock">
                  🆕 {t.unlockedCharacters.join("・")} 解放（次の回帰から登場）
                </span>
              ) : null}
              {t.regressed ? (
                <span className="mark mark-regress">↻ ハル力尽き、時は巻き戻る</span>
              ) : null}
            </div>
          )}
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
          {t.llmTimings && t.llmTimings.length > 0 && (
            <TimingBlock timings={t.llmTimings} />
          )}
          <div className="log-notable">注目の変化: {t.notable}</div>
        </div>
      ))}
    </div>
  );
}
