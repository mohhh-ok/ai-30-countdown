// キャラの顔アバター（丸／角丸）。絵があれば肖像、無ければ頭文字のプレースホルダに落とす。
// 個別ページの大きな char-portrait とは別に、ナビ・カード・主役などへ小さく差すための共通部品。
import { useState } from "react";

export function CharAvatar({
  id,
  name,
  size = 40,
  square = false,
  className = "",
}: {
  id: string;
  name: string;
  size?: number;
  /** 角丸（false=円）。主役の肖像など大きめのときに使う。 */
  square?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const cls = `char-avatar avatar-${id}${square ? " char-avatar-sq" : ""}${
    className ? ` ${className}` : ""
  }`;
  const style = { width: size, height: size } as const;

  // 絵が未生成（onError）のキャラは頭文字の丸チップで代替し、レイアウトを崩さない
  if (failed) {
    return (
      <span
        className={`${cls} char-avatar-fallback`}
        style={style}
        role="img"
        aria-label={name}
      >
        {name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      className={cls}
      style={style}
      src={`/assets/characters/${id}.webp`}
      alt={name}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
