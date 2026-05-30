// 京都の場所の簡易マップ。各場所に誰がいるかを示す。
import type { Character, Place } from "../../domain/types.ts";

export function PlacesMap({
  places,
  characters,
}: {
  places: Place[];
  characters: Character[];
}) {
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
            <div className="map-name">{p.name}</div>
            <div className="map-forage">
              実り 通常{p.forage.normal}/不作{p.forage.lean}
            </div>
            <div className="map-occupants">
              {here.length
                ? here.map((c) => (
                    <span key={c.id} className="occupant">
                      {c.name}
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
