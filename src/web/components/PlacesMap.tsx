// 京都の場所の簡易マップ。各場所に誰がいるかを示す。
import type { Character, Place } from "../../domain/types.ts";
import { useDomainNames, useT } from "../i18n.tsx";

export function PlacesMap({
  places,
  characters,
}: {
  places: Place[];
  characters: Character[];
}) {
  const t = useT();
  const dn = useDomainNames();
  return (
    <div className="map">
      {places.map((p) => {
        const here = characters.filter(
          (c) => c.alive && c.currentPlaceId === p.id,
        );
        return (
          <div
            key={p.id}
            className={`map-place${here.length ? " occupied" : ""}`}
            title={p.description}
          >
            <img
              className="map-thumb"
              src={`/assets/places/${p.id}.webp`}
              alt={dn.place(p.id, p.name)}
              loading="lazy"
              onError={(e) => {
                // 絵が無い場所は画像だけ隠す（キャラ絵と同じ流儀）
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="map-name">{dn.place(p.id, p.name)}</div>
            <div className="map-forage">
              {t("map_forage", { normal: p.forage.normal, lean: p.forage.lean })}
            </div>
            <div className="map-occupants">
              {here.length
                ? here.map((c) => (
                    <span key={c.id} className="occupant">
                      {dn.char(c.id, c.name)}
                    </span>
                  ))
                : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
