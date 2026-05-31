// 依存ゼロのハッシュルーター。サーバは "/" しか配信しないので、ページ遷移は
// すべて location.hash で表現する（catch-all ルートも履歴 API も要らない）。
//   #/            … ホーム（現在の回帰のみ）
//   #/loops       … 回帰一覧
//   #/loop/3      … 第3回帰の物語
//   #/char/haru   … キャラ別ページ（全周横断）
import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "loops" }
  | { name: "loop"; loop: number }
  | { name: "char"; id: string };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "loops") return { name: "loops" };
  if (parts[0] === "loop" && parts[1]) {
    const loop = Number(parts[1]);
    if (Number.isFinite(loop)) return { name: "loop", loop };
  }
  if (parts[0] === "char" && parts[1]) return { name: "char", id: parts[1] };
  return { name: "home" };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parse(typeof location !== "undefined" ? location.hash : ""),
  );
  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
