// 舞台＝妖の京。神と妖の棲む、もうひとつの京都。
// 鴨川を人と妖の交わる岸＝ハブに、北の霊地（大原・貴船）、西（嵐山）、南（伏見）が広がる。
// 各地には「民の霊力」（和み＝和やぎの気／荒び＝猛き念）が溜まり、集霊で枯れ、ゆっくり回復する。
// （内部フィールドは sei＝和み、daku＝荒び。荒びは穢れではなく神の猛き面で、鎮めれば和みへ和らぐ。）
import type { Place } from "./types.ts";

export const PLACES: Place[] = [
  {
    id: "kamogawa",
    name: "鴨川の河原",
    description:
      "人と妖の交わる岸。市井の人がもっとも多く行き交い、和みも荒びもまじり合う。どこへ向かうにも通り道になる要の地。",
    appearance:
      "A lively riverbank of the Kamo River in an old-Kyoto spirit world. " +
      "Wide stone-strewn shore beside flowing water, traditional machiya townhouses and a wooden bridge in the distance, " +
      "warm bustling crossroads atmosphere where humans and spirits mingle, lanterns and market stalls.",
    forage: { normal: 10, lean: 3 }, // 1日に頂ける上限
    populace: { sei: 42, daku: 30 },
    populaceMax: { sei: 42, daku: 30 },
    regen: { sei: 6, daku: 4 },
    neighbors: ["ohara", "kibune", "arashiyama", "fushimi"],
  },
  {
    id: "ohara",
    name: "大原の隠れ里",
    description:
      "洛北の山あいに開けた里。祈りと暮らしの澄んだ気に満ち、和みが豊か。穏やかだが人は多くない。",
    appearance:
      "A secluded mountain village in the northern hills of an old-Kyoto spirit world. " +
      "Terraced rice fields and thatched-roof farmhouses nestled among forested slopes, " +
      "a small wayside shrine, serene prayerful atmosphere, clear pure air with drifting morning mist.",
    forage: { normal: 14, lean: 5 },
    populace: { sei: 56, daku: 6 },
    populaceMax: { sei: 56, daku: 6 },
    regen: { sei: 8, daku: 1 },
    neighbors: ["kamogawa", "kibune"],
  },
  {
    id: "kibune",
    name: "貴船の渓",
    description:
      "鞍馬の奥、水神の宿る清流の谷。和みは澄んで安定するが、人里離れて細い。静寂の地。",
    appearance:
      "A deep secluded ravine of the Kibune valley in an old-Kyoto spirit world. " +
      "A crystal-clear mountain stream tumbling over rocks through dense green forest, " +
      "vermilion lanterns and a water-god shrine, hushed sacred stillness, cool dappled light, faint glowing spirit-wisps.",
    forage: { normal: 7, lean: 5 },
    populace: { sei: 34, daku: 4 },
    populaceMax: { sei: 34, daku: 4 },
    regen: { sei: 5, daku: 1 },
    neighbors: ["kamogawa", "ohara"],
  },
  {
    id: "arashiyama",
    name: "嵐山の竹林",
    description:
      "西郊、保津川と竹の精の地。旅人が行き交い、和みと荒びが中ほどにまじる。",
    appearance:
      "A misty bamboo grove in the western outskirts of an old-Kyoto spirit world (Arashiyama). " +
      "Towering green bamboo stalks lining a winding path, the Hozu River and a wooden bridge nearby, " +
      "travelers and bamboo spirits passing through, soft filtered green light and drifting haze.",
    forage: { normal: 12, lean: 3 },
    populace: { sei: 38, daku: 18 },
    populaceMax: { sei: 38, daku: 18 },
    regen: { sei: 6, daku: 3 },
    neighbors: ["kamogawa"],
  },
  {
    id: "fushimi",
    name: "伏見の稲荷",
    description:
      "南の狐の地。人の欲と願いが渦を巻き、荒びが濃くこもる。霊力は大きく猛々しいが和みは細い、荒ぶる神威の渦巻く土地。",
    appearance:
      "The fox shrine of Fushimi Inari in an old-Kyoto spirit world. " +
      "Endless tunnels of vermilion torii gates climbing a forested hillside, stone fox statues with red bibs, " +
      "dense restless air thick with desire and prayer, smoldering lantern light and lingering shadows.",
    forage: { normal: 16, lean: 2 },
    populace: { sei: 18, daku: 46 },
    populaceMax: { sei: 18, daku: 46 },
    regen: { sei: 2, daku: 6 },
    neighbors: ["kamogawa"],
  },
];

export function placesCopy(): Place[] {
  // 各 Place を複製（neighbors 配列・プールも複製）
  return PLACES.map((p) => ({
    ...p,
    neighbors: [...p.neighbors],
    populace: { ...p.populace },
    populaceMax: { ...p.populaceMax },
    regen: { ...p.regen },
  }));
}

export function findPlace(places: Place[], id: string): Place | undefined {
  return places.find((p) => p.id === id);
}

/** from から to へ1ステップで移動できるか（隣接か） */
export function isNeighbor(places: Place[], fromId: string, toId: string): boolean {
  const from = findPlace(places, fromId);
  return !!from && from.neighbors.includes(toId);
}

/**
 * from から to へ1歩近づく隣接 id を返す。
 * 直接隣接ならそこへ、さもなくば to に最も近い隣接（簡易 BFS）。無ければ undefined。
 */
export function stepToward(
  places: Place[],
  fromId: string,
  toId: string,
): string | undefined {
  const from = findPlace(places, fromId);
  if (!from || fromId === toId) return undefined;
  if (from.neighbors.includes(toId)) return toId;
  // BFS で to までの最短経路の最初の一歩を求める
  const queue: string[][] = from.neighbors.map((n) => [n]);
  const seen = new Set<string>([fromId, ...from.neighbors]);
  while (queue.length) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    if (last === toId) return path[0];
    const node = findPlace(places, last);
    for (const nb of node?.neighbors ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push([...path, nb]);
      }
    }
  }
  return from.neighbors[0]; // 経路不明なら適当な一歩
}

/**
 * from から to までの最短ホップ数を返す（同じ場所なら 0、到達不能なら Infinity）。
 * 衝動で「最も近い相手」へ動くときの距離比較に使う。
 */
export function distance(places: Place[], fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const from = findPlace(places, fromId);
  if (!from) return Infinity;
  const seen = new Set<string>([fromId]);
  let frontier: string[] = [fromId];
  let hops = 0;
  while (frontier.length) {
    hops += 1;
    const next: string[] = [];
    for (const id of frontier) {
      const node = findPlace(places, id);
      for (const nb of node?.neighbors ?? []) {
        if (nb === toId) return hops;
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}
