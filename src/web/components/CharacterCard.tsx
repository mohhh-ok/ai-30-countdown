// 1人ぶんの現在状態カード（エネルギー・パラメータ・段階・日記）
import type {
  Character,
  CharacterTickResult,
  ParamKey,
} from "../../domain/types.ts";
import { stageOf } from "../../domain/rules.ts";
import { ParamBar } from "./ParamBar.tsx";
import { CharAvatar } from "./CharAvatar.tsx";
import { useDomainNames, useT } from "../i18n.tsx";

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
  const t = useT();
  const dn = useDomainNames();
  const c = character;
  const axisValue = c.params[c.growthAxis];
  const stage = stageOf(axisValue);
  const energyPct = Math.max(0, Math.min(100, (c.energy / MAX_ENERGY) * 100));
  const energyDelta = last?.energyDelta;

  const paramName: Record<ParamKey, string> = {
    altruism: t("param_altruism"),
    independence: t("param_independence"),
    trust: t("param_trust"),
  };
  const params: { key: ParamKey; label: string }[] = [
    { key: "altruism", label: paramName.altruism },
    { key: "independence", label: paramName.independence },
    { key: "trust", label: paramName.trust },
  ];

  const moods: { key: keyof Character["mood"]; label: string; color: string }[] = [
    { key: "elation", label: t("mood_elation"), color: "#e8b04b" },
    { key: "warmth", label: t("mood_warmth"), color: "#e87aa6" },
    { key: "calm", label: t("mood_calm"), color: "#6fbf73" },
    { key: "stress", label: t("mood_stress"), color: "#d8696b" },
  ];
  const antibodies: { key: keyof Character["antibodies"]; label: string }[] = [
    { key: "achievement", label: t("ab_achievement") },
    { key: "bond", label: t("ab_bond") },
    { key: "comfort", label: t("ab_comfort") },
    { key: "thrill", label: t("ab_thrill") },
  ];

  return (
    <div className={`card${c.alive ? "" : " dead"}${spotlight ? " spotlight" : ""}`}>
      {spotlight && <span className="spotlight-badge">{t("card_spotlight")}</span>}
      <div className="card-head">
        <div className="card-head-name">
          <CharAvatar id={c.id} name={dn.char(c.id, c.name)} size={52} />
          <h2>{dn.char(c.id, c.name)}</h2>
        </div>
        <span className={`stage stage-${stage}`}>
          {paramName[c.growthAxis]}: {dn.stage(stage)}
        </span>
      </div>
      <p className="core">{c.core}</p>
      {(c.frenzy?.active || last?.becameFrenzied || last?.quelledFrenzy) && (
        <div className={`card-frenzy${last?.quelledFrenzy && !c.frenzy?.active ? " quelled" : ""}`}>
          {last?.becameFrenzied
            ? t("frenzy_became")
            : last?.quelledFrenzy && !c.frenzy?.active
              ? t("frenzy_quelled")
              : `${t("frenzy_active")}${
                  typeof c.frenzy?.level === "number" ? t("frenzy_lv", { n: c.frenzy.level }) : ""
                }${c.frenzy?.pendingBurden ? t("frenzy_burden", { n: c.frenzy.pendingBurden }) : ""}`}
        </div>
      )}
      {placeName && (
        <div className="place-now">
          <span className="pin">📍</span>
          {placeName}
          {last?.moved && (
            <span className="moved-tag">
              {t("moved_from", {
                place: last.fromPlaceId
                  ? dn.place(last.fromPlaceId, last.fromPlaceName ?? "")
                  : (last.fromPlaceName ?? ""),
              })}
            </span>
          )}
        </div>
      )}

      <div className="energy">
        <span className="energy-label">{t("energy_label")}</span>
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
        <div className="section-label">{t("mood_section")}</div>
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
        <div className="section-label">{t("ab_section")}</div>
        <div className="ab-chips">
          {antibodies.map((a) => {
            const v = c.antibodies[a.key];
            return (
              <span
                key={a.key}
                className="ab-chip"
                title={t("ab_title", { label: a.label, v })}
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
          <div className="section-label">{t("rewards_section")}</div>
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
        <span className="diary-mark">{t("diary_mark")}</span>
        <span className="diary-text">
          {c.diary.length ? `「${c.diary[c.diary.length - 1]}」` : t("diary_empty")}
        </span>
      </div>

      {!c.alive && <div className="dead-banner">{t("dead_banner")}</div>}
    </div>
  );
}
