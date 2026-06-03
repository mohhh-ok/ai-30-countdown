// 時刻の共通ブリッジ（DB ⇄ dayjs ⇄ 表示）。
//
// 方針（合意済み）:
//  - 保存は常に UTC ISO8601（末尾 Z）。SQLite には日時専用型が無いので TEXT に UTC で持つ。
//  - 表示の瞬間だけ変換する（store in UTC, display in local）。
//  - サーバ側ログ/スクリプトは「ブラウザが無い」ので固定TZ（既定 Asia/Tokyo）で出す。
//  - フロント表示はブラウザのローカルTZに追従させる（fmtLocal）。
//
// 型でも締める（branded type UtcIso）。DB から読んだ素の string は、読み出し層で
// 一度だけ asUtc() を通してから流す＝「入口（ブリッジ）」を1か所に集約する。

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

/** UTC ISO8601 文字列であることを型で保証する branded type。 */
export type UtcIso = string & { readonly __utc: unique symbol };

/** サーバ側ログ/スクリプトの既定TZ。ブラウザが無い環境はこれで固定表示する。 */
export const SERVER_TZ = "Asia/Tokyo";

/** 現在時刻を UTC ISO8601（Z付き）で返す。DB 書き込みの唯一の現在時刻ソース。 */
export function nowISO(): UtcIso {
  return dayjs.utc().toISOString() as UtcIso;
}

/**
 * DB から読んだ素の string を UtcIso に持ち上げる「入口」。
 * 値が UTC ISO8601 である前提を1か所に集約する（握りつぶさず、空なら throw）。
 */
export function asUtc(s: string): UtcIso {
  if (!s) throw new Error("asUtc: 空文字は UTC ISO として扱えません");
  return s as UtcIso;
}

/**
 * フロント表示用。実行環境（ブラウザ）のローカルTZに自動で合わせる。
 * 注意: サーバで呼ぶとサーバTZに従うので、サーバ側は fmtFixed/fmtClock を使うこと。
 */
export function fmtLocal(iso: UtcIso, format = "YYYY-MM-DD HH:mm:ss"): string {
  return dayjs.utc(iso).local().format(format);
}

/**
 * サーバlog/script用。固定TZ（既定 JST）でフル日時（ミリ秒まで）を出す。
 * オフセット（例 +09:00）も付けて、アーカイブされても曖昧さが残らないようにする。
 */
export function fmtFixed(iso: UtcIso, tz: string = SERVER_TZ): string {
  return dayjs.utc(iso).tz(tz).format("YYYY-MM-DD HH:mm:ss.SSS Z");
}

/**
 * サーバlog用の時計（HH:mm:ss.SSS）。固定TZ（既定 JST）。
 * 引数省略時は現在時刻。log.ts の従来 ts() 置き換え。
 */
export function fmtClock(iso: UtcIso = nowISO(), tz: string = SERVER_TZ): string {
  return dayjs.utc(iso).tz(tz).format("HH:mm:ss.SSS");
}
