// 成長パラメータ1本ぶんのバー表示
import type { ParamKey } from "../../domain/types.ts";
import { useT } from "../i18n.tsx";

const COLORS: Record<ParamKey, string> = {
  altruism: "#e8995a",
  independence: "#5a9be8",
  trust: "#6fbf73",
};

export function ParamBar({
  label,
  value,
  paramKey,
  delta,
  isAxis,
}: {
  label: string;
  value: number;
  paramKey: ParamKey;
  delta?: number;
  isAxis?: boolean;
}) {
  const t = useT();
  return (
    <div className={`param-row${isAxis ? " param-axis" : ""}`}>
      <span className="param-label">
        {label}
        {isAxis && <span className="axis-mark">{t("param_axis")}</span>}
      </span>
      <div className="param-track">
        <div
          className="param-fill"
          style={{ width: `${value}%`, background: COLORS[paramKey] }}
        />
      </div>
      <span className="param-value">
        {value}
        {typeof delta === "number" && delta !== 0 && (
          <span className={delta > 0 ? "delta up" : "delta down"}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </span>
    </div>
  );
}
