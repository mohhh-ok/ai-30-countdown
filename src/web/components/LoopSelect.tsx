// 回帰ジャンプ用セレクト。「第N回帰」ピル表示そのものを select にして、
// 選んだ回帰のページ（#/loop/N）へ直接飛ぶ（旧・回帰一覧ページの代替）。
import type { Chronicle } from "../../domain/types.ts";
import { useT } from "../i18n.tsx";

export function LoopSelect({
  chronicle,
  value,
}: {
  chronicle: Chronicle | null;
  value: number;
}) {
  const t = useT();
  const current = chronicle?.loop ?? 1;
  // chronicle 未ロード（null）や範囲外の value では、対応する option が無く
  // React が「value に一致する option が無い」警告を出すので、描画しない。
  if (!chronicle || value > current || value < 1) return null;
  // 新しい周が上に来るよう降順で並べる（旧一覧ページと同じ並び）。
  const loops = Array.from({ length: current }, (_, i) => current - i);
  return (
    <select
      className="loop-num loop-select"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        // 最新（進行中）の回帰はライブで観られるホームへ。過去周のみ専用ページへ飛ぶ。
        location.hash = n === current ? "#/" : `#/loop/${n}`;
      }}
      aria-label={t("loop_select_label")}
    >
      {loops.map((n) => (
        <option key={n} value={n}>
          {t("loop_label", { n })}
        </option>
      ))}
    </select>
  );
}
