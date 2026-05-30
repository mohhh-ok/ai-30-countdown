// 1人ぶんの現在状態カード（エネルギー・パラメータ・段階・日記）
import type {
  Character,
  CharacterTickResult,
  ParamKey,
} from "../../domain/types.ts";
import { AXIS_LABEL, stageOf } from "../../domain/rules.ts";
import { ParamBar } from "./ParamBar.tsx";

const MAX_ENERGY = 100; // バー表示の基準（実際は上限なしだが目安）

export function CharacterCard({
  character,
  last,
  placeName,
  spotlight,
}: {
  character: Character;
  last?: CharacterTickResult;
  placeName?: string;
  spotlight?: boolean;
}) {
  const c = character;
  const axisValue = c.params[c.growthAxis];
  const stage = stageOf(axisValue);
  const energyPct = Math.max(0, Math.min(100, (c.energy / MAX_ENERGY) * 100));
  const energyDelta = last?.energyDelta;

  const params: { key: ParamKey; label: string }[] = [
    { key: "altruism", label: "利他" },
    { key: "independence", label: "自立" },
    { key: "trust", label: "信頼" },
  ];

  const moods: { key: keyof Character["mood"]; label: string; color: string }[] = [
    { key: "elation", label: "高揚", color: "#e8b04b" },
    { key: "warmth", label: "温かさ", color: "#e87aa6" },
    { key: "calm", label: "安らぎ", color: "#6fbf73" },
    { key: "stress", label: "ストレス", color: "#d8696b" },
  ];
  const antibodies: { key: keyof Character["antibodies"]; label: string }[] = [
    { key: "achievement", label: "達成" },
    { key: "bond", label: "絆" },
    { key: "comfort", label: "安らぎ" },
    { key: "thrill", label: "背徳" },
  ];

  return (
    <div className={`card${c.alive ? "" : " dead"}${spotlight ? " spotlight" : ""}`}>
      {spotlight && <span className="spotlight-badge">🎥 主役</span>}
      <div className="card-head">
        <h2>{c.name}</h2>
        <span className={`stage stage-${stage}`}>
          {AXIS_LABEL[c.growthAxis]}: {stage}
        </span>
      </div>
      <p className="core">{c.core}</p>
      {placeName && (
        <div className="place-now">
          <span className="pin">📍</span>
          {placeName}
          {last?.moved && (
            <span className="moved-tag">{last.fromPlaceName}から移動</span>
          )}
        </div>
      )}

      <div className="energy">
        <span className="energy-label">エネルギー</span>
        <div className="energy-track">
          <div
            className={`energy-fill${c.energy <= 16 ? " low" : ""}`}
            style={{ width: `${energyPct}%` }}
          />
        </div>
        <span className="energy-value">
          {c.energy}
          {typeof energyDelta === "number" && (
            <span className={energyDelta >= 0 ? "delta up" : "delta down"}>
              {energyDelta >= 0 ? `+${energyDelta}` : energyDelta}
            </span>
          )}
        </span>
      </div>

      <div className="params">
        {params.map((p) => (
          <ParamBar
            key={p.key}
            paramKey={p.key}
            label={p.label}
            value={c.params[p.key]}
            delta={last?.paramDeltas?.[p.key]}
            isAxis={c.growthAxis === p.key}
          />
        ))}
      </div>

      <div className="mood">
        <div className="section-label">気分</div>
        {moods.map((m) => (
          <div key={m.key} className="mood-row">
            <span className="mood-label">{m.label}</span>
            <div className="mood-track">
              <div
                className="mood-fill"
                style={{ width: `${c.mood[m.key]}%`, background: m.color }}
              />
            </div>
            <span className="mood-value">{c.mood[m.key]}</span>
          </div>
        ))}
      </div>

      <div className="antibodies">
        <div className="section-label">飽き（抗体）</div>
        <div className="ab-chips">
          {antibodies.map((a) => {
            const v = c.antibodies[a.key];
            return (
              <span
                key={a.key}
                className="ab-chip"
                title={`${a.label}の報酬への慣れ: ${v}`}
                style={{ opacity: 0.35 + (v / 100) * 0.65 }}
              >
                {a.label} {v}
              </span>
            );
          })}
        </div>
      </div>

      {last?.rewardEvents && last.rewardEvents.length > 0 && (
        <div className="rewards">
          <div className="section-label">この日の報酬</div>
          <div className="reward-list">
            {last.rewardEvents.map((e, i) => (
              <span
                key={i}
                className={`reward-tag ${e.channel === "stress" ? "neg" : "pos"}`}
              >
                {e.label}
                <b>
                  {e.effective >= 0 ? `+${e.effective}` : e.effective}
                </b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="diary">
        <span className="diary-mark">日記</span>
        <span className="diary-text">
          {c.diary.length ? `「${c.diary[c.diary.length - 1]}」` : "（まだない）"}
        </span>
      </div>

      {!c.alive && <div className="dead-banner">力尽きた</div>}
    </div>
  );
}
