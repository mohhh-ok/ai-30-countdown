// キャラの表示色（プレゼン層の一元管理）。
// 「誰の声か」を会話バブル等で色分けするための地色／文字色。
// ドメイン(Character)は色を持たない＝見た目の都合はここに閉じる。
// 既知キャラは手調整パレット、未知 id は id から決定的に自動採色（CSS追記は不要）。

export type CharColor = { bg: string; fg: string };

/** 手調整パレット（id→色）。新キャラを足したいときだけここに1行。無ければ自動採色に落ちる。 */
const PALETTE: Record<string, CharColor> = {
  haru: { bg: "#2a3340", fg: "#d4e3f0" }, // クール: 青系
  nagi: { bg: "#3a2e22", fg: "#f0e0cd" }, // 陽: 暖色
  kai: { bg: "#3a2433", fg: "#f0d4e6" }, // 餓: 紫
};

/** id を決定的に色相へ。同じ id は常に同じ色になる。
 *  途中で % 360 すると分布が偏るので、畳み込みは生のまま行い最後に 0..359 へ落とす。 */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

/** 既知なら手調整色、未知なら id 由来の落ち着いた暗色を返す。 */
export function charColor(id: string): CharColor {
  const known = PALETTE[id];
  if (known) return known;
  const h = hueFromId(id);
  // 既知パレットと馴染む「暗い地色＋淡い文字色」のトーンに揃える
  return { bg: `hsl(${h} 28% 17%)`, fg: `hsl(${h} 40% 86%)` };
}
