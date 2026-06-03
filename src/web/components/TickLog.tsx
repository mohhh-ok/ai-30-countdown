// ティックログ（plan.md 第10節の出力フォーマット相当をカード化）
import type { CSSProperties } from "react";
import type { LlmCallTiming, TickResult } from "../../domain/types.ts";
import { charColor } from "../charTheme.ts";
import {
  useDiary,
  useDomainNames,
  useFrenzyNarration,
  useLocalized,
  useSep,
  useT,
} from "../i18n.tsx";

/** ミリ秒を読みやすく（1秒以上は「1.2s」、未満は「840ms」）。 */
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** その日の LLM 呼び出し時間の内訳。種別（label の ":" 前）でまとめ、合計が大きい順に並べる。 */
function TimingBlock({ timings }: { timings: LlmCallTiming[] }) {
  const t = useT();
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
        {t("tlog_timing_head", { n: timings.length, total: fmtMs(totalMs) })}
        <span className="timing-slow">
          {t("tlog_timing_slow", { label: slowest.label, ms: fmtMs(slowest.ms) })}
        </span>
        {fails > 0 && (
          <span className="timing-fail">{t("tlog_timing_fail", { n: fails })}</span>
        )}
      </span>
      <span className="timing-groups">
        {rows.map(([kind, g]) => (
          <span
            key={kind}
            className="timing-group"
            title={t("tlog_timing_group_title", { count: g.count, max: fmtMs(g.max) })}
          >
            {kind} {fmtMs(g.sum)}
            <span className="timing-count">×{g.count}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

export function TickLog({ log }: { log: TickResult[] }) {
  const tr = useT();
  const dn = useDomainNames();
  const sep = useSep();
  const loc = useLocalized();
  const frenzyNarration = useFrenzyNarration();
  const diary = useDiary();
  if (log.length === 0) {
    return <p className="log-empty">{tr("tlog_empty")}</p>;
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
              {t.weather === "normal"
                ? tr("tlog_weather_normal")
                : tr("tlog_weather_lean")}
            </span>
            {t.worldEvents?.map((e) => {
              const dayNo = e.totalDays - e.remainingDays + 1;
              const isNew = t.newWorldEvents?.some((n) => n.kind === e.kind);
              return (
                <span
                  key={e.kind}
                  className={`world-event world-event-${e.kind}${isNew ? " world-event-new" : ""}`}
                  title={tr("tlog_event_title", { n: dayNo, total: e.totalDays })}
                >
                  {e.icon} {dn.event(e.kind, e.name)}
                  {isNew
                    ? tr("tlog_event_new")
                    : tr("tlog_event_progress", { n: dayNo, total: e.totalDays })}
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
                  {tr("tlog_mark_skill", {
                    skills: t.acquiredSkills.map(dn.skillByName).join(sep.skills),
                  })}
                </span>
              ) : null}
              {t.unlockedCharacters?.length ? (
                <span className="mark mark-unlock">
                  {tr("tlog_mark_unlock", {
                    names: t.unlockedCharacters.map(dn.charByName).join(sep.list),
                  })}
                </span>
              ) : null}
              {t.regressed ? (
                <span className="mark mark-regress">{tr("tlog_mark_regress")}</span>
              ) : null}
            </div>
          )}
          {t.spotlightName && (
            <div className="spotlight-line">
              <span className="cam">🎥</span>
              {tr("tlog_spotlight_label")}
              <strong>
                {t.spotlightId
                  ? dn.char(t.spotlightId, t.spotlightName)
                  : t.spotlightName}
              </strong>
              {t.spotlightReason && (
                <span className="spotlight-reason">— {t.spotlightReason}</span>
              )}
            </div>
          )}
          {t.director && (
            <div className="narration">
              <span className="clap">🎬</span>
              <span className="narration-text">
                {[loc(t.director.narration, "narration"), frenzyNarration(t.characters)]
                  .filter(Boolean)
                  .join("\n")}
              </span>
              <span className="narration-intent" title={t.director.intent}>
                {tr("tlog_intent", { intent: t.director.intent })}
                {t.director.forageBoosts.length > 0 &&
                  tr("tlog_forage_op", {
                    ops: t.director.forageBoosts
                      .map((b) => `${b.delta >= 0 ? "+" : ""}${b.delta}`)
                      .join("/"),
                  })}
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
                    <span className="whisper-to">
                      {tr("tlog_whisper_to", { name: dn.char(w.id, name) })}
                    </span>
                    <span className="whisper-text">「{w.whisper}」</span>
                  </div>
                );
              })}
            </div>
          )}
          {t.characters.map((c) => (
            <div key={c.id} className="log-line">
              <span className="log-name">{dn.char(c.id, c.name)}</span>
              <span className="log-action">
                {c.moved && c.fromPlaceName
                  ? tr("tlog_moved", {
                      from: c.fromPlaceId
                        ? dn.place(c.fromPlaceId, c.fromPlaceName)
                        : c.fromPlaceName,
                      to: dn.place(c.placeId, c.placeName),
                    })
                  : dn.action(c.action, c.actionLabel)}
                {c.targetName && (
                  <span className="log-target">
                    → {c.targetId ? dn.char(c.targetId, c.targetName) : c.targetName}
                  </span>
                )}
                {c.impulse && <span className="impulse-tag">{tr("tlog_impulse")}</span>}
              </span>
              <span className="log-place">＠{dn.place(c.placeId, c.placeName)}</span>
              <span className="log-energy">
                {c.energyBefore}→{c.energyAfter}
                <span className={c.energyDelta >= 0 ? "delta up" : "delta down"}>
                  {c.energyDelta >= 0 ? `+${c.energyDelta}` : c.energyDelta}
                </span>
              </span>
              {(() => {
                const dt = diary(c.diary, c.diaryNote);
                return dt ? <span className="log-diary">「{dt}」</span> : null;
              })()}
              {c.stageChanged && (
                <span className="log-stage">
                  {tr("tlog_stage", {
                    before: dn.stage(c.stageBefore),
                    after: dn.stage(c.stageAfter),
                  })}
                </span>
              )}
              {c.died && <span className="log-died">{tr("dead_banner")}</span>}
              {c.frenzyLevel !== undefined && (c.frenzyLevel > 0 || c.frenzyActive) && (
                <span className="log-frenzy">
                  {tr("tlog_frenzy", { n: c.frenzyLevel })}
                  {c.frenzyActive ? tr("tlog_frenzy_active") : ""}
                  {c.becameFrenzied ? tr("tlog_frenzy_became") : ""}
                  {c.frenzyPendingBurden
                    ? tr("tlog_frenzy_burden", { n: c.frenzyPendingBurden })
                    : ""}
                </span>
              )}
              {c.facedFrenzy && (
                <span className="log-frenzy">
                  {c.quelledFrenzy ? tr("tlog_quelled") : tr("tlog_faced")}
                </span>
              )}
            </div>
          ))}
          {t.dialogue && t.dialogue.length > 0 && (
            <div className="dialogue">
              {t.dialogue.map((line, i) => {
                // 観客ビューと統一: 主役(spotlight)=右、相手=左。色は charTheme の map から。
                // 古いログで spotlightId 未設定なら undefined 同士の誤一致を避ける。
                const isHero = !!t.spotlightId && line.speakerId === t.spotlightId;
                const col = charColor(line.speakerId);
                return (
                  <div
                    key={i}
                    className={`bubble ${isHero ? "bubble-right" : "bubble-left"}`}
                    style={
                      {
                        "--bubble-bg": col.bg,
                        "--bubble-fg": col.fg,
                      } as CSSProperties
                    }
                  >
                    <span className="speaker">
                      {dn.char(line.speakerId, line.speakerName)}
                    </span>
                    <span className="bubble-text">{loc(line.text, "dialogue")}</span>
                  </div>
                );
              })}
            </div>
          )}
          {t.llmTimings && t.llmTimings.length > 0 && (
            <TimingBlock timings={t.llmTimings} />
          )}
          <div className="log-notable">
            {tr("tlog_notable_label")}
            {/* TODO(i18n): notable は engine 生成の日本語文（issue #8 で翻訳予定） */}
            {t.notable}
          </div>
        </div>
      ))}
    </div>
  );
}
