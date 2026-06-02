// LLM を使わない簡易プロバイダ。テスト/動作確認を高速に回すため。
// 芯に沿ったごく単純なルールで行動を決める（生成品質は問わない）。
import type {
  Action,
  Character,
  DecisionProvider,
  DialogueProvider,
  DirectorProvider,
  TickDecision,
  WorldState,
} from "../domain/types.ts";
import { NEEDS_PARTNER } from "../domain/rules.ts";
import { distance, findPlace } from "../domain/places.ts";

/** seed から決定論的な擬似乱数を作る（mulberry32） */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 最も近い「別の場所にいる相手」へ1歩近づく隣接 id を返す（無ければ undefined） */
function stepTowardNearest(state: WorldState, from: Character, others: Character[]): string | undefined {
  const here = findPlace(state.places, from.currentPlaceId);
  if (!here) return undefined;
  const away = others
    .filter((o) => o.currentPlaceId !== from.currentPlaceId)
    .sort(
      (a, b) =>
        distance(state.places, from.currentPlaceId, a.currentPlaceId) -
        distance(state.places, from.currentPlaceId, b.currentPlaceId),
    );
  const nearest = away[0];
  if (!nearest) return undefined;
  if (here.neighbors.includes(nearest.currentPlaceId)) return nearest.currentPlaceId;
  return here.neighbors[0]; // ハブ経由の一歩
}

/** いまの地で得られる霊力（異能で見方が変わる） */
function availableHere(state: WorldState, c: Character): number {
  const p = findPlace(state.places, c.currentPlaceId);
  if (!p) return 0;
  return c.talent === "devour" ? p.populace.sei + p.populace.daku : p.populace.sei;
}

/** 隣接で最も霊力が残っている地の id（無ければ undefined） */
function richestNeighbor(state: WorldState, c: Character): string | undefined {
  const here = findPlace(state.places, c.currentPlaceId);
  if (!here) return undefined;
  const avail = (id: string) => {
    const p = findPlace(state.places, id);
    if (!p) return -1;
    return c.talent === "devour" ? p.populace.sei + p.populace.daku : p.populace.sei;
  };
  const best = [...here.neighbors].sort((a, b) => avail(b) - avail(a))[0];
  return best && avail(best) > availableHere(state, c) ? best : undefined;
}

export function createMockProvider(rng: () => number = Math.random): DecisionProvider {
  return async (state: WorldState): Promise<TickDecision> => {
    const living = state.characters.filter((c) => c.alive);
    return {
      characters: living.map((c) => {
        const others = living.filter((o) => o.id !== c.id);
        const hereOthers = others.filter((o) => o.currentPlaceId === c.currentPlaceId);
        const hasPeer = hereOthers.length > 0;
        // 同室の相手は「最も慕わしい（＝とりあえず先頭）」を相手に選ぶ簡易ルール
        const peer = hereOthers[0];

        let action: Action = "forage";
        let moveTarget: string | undefined;
        let targetId: string | undefined;

        if (c.energy < c.satiety) {
          // まだ満たされていない → 確保（生存）。ただし今の地が枯れていれば、霊力の残る隣地へ移ろう。
          if (availableHere(state, c) < 4) {
            const richer = richestNeighbor(state, c);
            if (richer) {
              action = "move";
              moveTarget = richer;
            } else {
              action = "forage";
            }
          } else {
            action = "forage";
          }
        } else {
          // 満たされている → 抗体が低い（飽きていない）報酬を求めて動く。
          //  これにより同じ行動を続けると飽き、別の手に切り替わる。
          const cand: { action: Action; moveTarget?: string; targetId?: string; ab: number }[] = [];
          cand.push({ action: "forage", ab: c.antibodies.achievement });
          cand.push({ action: "rest", ab: c.antibodies.comfort });
          // 荒れた地（荒びが猛った地）にいるなら、祓い清める（鎮める）のも安らぎの一手
          const here = findPlace(state.places, c.currentPlaceId);
          if (here && here.populace.daku > 0) {
            cand.push({ action: "purify", ab: c.antibodies.comfort });
          }
          if (hasPeer) {
            cand.push({
              action: c.params.altruism >= 60 ? "share" : "talk",
              targetId: peer.id,
              ab: c.antibodies.bond,
            });
          } else {
            const target = stepTowardNearest(state, c, others);
            if (target) cand.push({ action: "move", moveTarget: target, ab: 10 });
            // 慕う相手が離れているなら、寄り添って近づく（follow は離れた相手にも選べる）
            const nearest = others
              .filter((o) => o.currentPlaceId !== c.currentPlaceId)
              .sort(
                (a, b) =>
                  distance(state.places, c.currentPlaceId, a.currentPlaceId) -
                  distance(state.places, c.currentPlaceId, b.currentPlaceId),
              )[0];
            if (nearest) {
              cand.push({ action: "follow", targetId: nearest.id, ab: c.antibodies.bond });
            }
          }
          // 抗体が最も低い（最も新鮮な）行動を選ぶ
          cand.sort((a, b) => a.ab - b.ab);
          action = cand[0].action;
          moveTarget = cand[0].moveTarget;
          targetId = cand[0].targetId;
        }

        // 相手が必要な行動なのに同室に誰もいないなら採取に倒す（engine 側でも保険）
        if (NEEDS_PARTNER[action] && !hasPeer) action = "forage";

        return {
          id: c.id,
          action,
          moveTarget,
          targetId,
          diary: `（mock）${c.name}は${action}を選んだ。`,
          relationLabel: c.relationLabel,
          paramDeltas: {},
          deltaReason: "",
        };
      }),
    };
  };
}

/** 簡易演出家: 膠着なら不作で揺さぶり、悲劇接近なら通常日で猶予を与える。 */
export function createMockDirector(rng: () => number = Math.random): DirectorProvider {
  return async (state, tension) => {
    let weather: "normal" | "lean" =
      rng() < 1 / 3 ? "lean" : "normal";
    let narration = "また一日が始まる。";
    let intent = "通常進行";
    const forageBoosts: { placeId: string; delta: number }[] = [];
    const directives: { id: string; intent: string }[] = [];

    const living = state.characters.filter((c) => c.alive);
    const places = new Set(living.map((c) => c.currentPlaceId));
    const separated = living.length >= 2 && places.size > 1;

    if (tension === "stagnant") {
      weather = "lean"; // 停滞を飢えで揺さぶる
      narration = "（mock）空はどんより。実りは乏しく、静けさが破られようとしている。";
      intent = "膠着を不作で揺さぶる";
      if (separated) {
        // 離れているなら守護神に「動いて出会え」と指示
        for (const c of living) {
          directives.push({ id: c.id, intent: "孤独に耐えかね、相手に会いに動き出してほしい" });
        }
      }
    } else if (tension === "tragic") {
      weather = "normal"; // 猶予を与えて見せ場に
      narration = "（mock）雲が切れ、わずかな光が差す。最後の選択の時かもしれない。";
      intent = "悲劇直前に猶予を与え見せ場を作る";
    } else if (tension === "calm") {
      narration = "（mock）穏やかな朝。だが、変化の予感がある。";
      intent = "平穏に小さなさざ波";
    } else {
      narration = "（mock）張り詰めた空気のまま、夜が明けた。";
      intent = "緊迫を維持";
    }
    // 主役: 最もストレスの高い生存者（同点なら先頭）にカメラを向ける
    const spot = [...living].sort((a, b) => b.mood.stress - a.mood.stress)[0];
    return {
      weather,
      narration,
      intent,
      forageBoosts,
      directives,
      spotlightId: spot?.id,
      spotlightReason: spot ? `${spot.name}のストレスが最も高い` : undefined,
    };
  };
}

/** 簡易守護神: 演出家の指示を、キャラ視点の短い囁きに変換する。 */
export function createMockGuardian(): import("../domain/types.ts").GuardianProvider {
  return async (state, directives) => {
    return directives.map((d) => {
      const c = state.characters.find((x) => x.id === d.id);
      const name = c?.name ?? d.id;
      return {
        id: d.id,
        whisper: `（mock・${name}の心の声）…${d.intent}。いまこそ動くときかもしれない。`,
      };
    });
  };
}

export function createMockDialogueProvider(): DialogueProvider {
  // 一発言ずつ返す簡易会話劇（生成品質は問わない）。history の長さでセリフと締めを決める。
  const lines = ["……話せるか。", "ああ。", "……達者でな。", "そちらも。"];
  return async (state, _weather, _speakers, history, nextSpeakerId) => {
    const name = state.characters.find((c) => c.id === nextSpeakerId)?.name ?? nextSpeakerId;
    const turn = history.length;
    const text = `（mock）${name}「${lines[turn % lines.length]}」`;
    const end = turn >= 3; // 4発言で締める
    return { text, end };
  };
}
