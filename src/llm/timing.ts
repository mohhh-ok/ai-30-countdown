// LLM 呼び出しの所要時間コレクタ。
// backend.chatJSON（全プロバイダ共通の funnel）が呼び出しごとに recordTiming で記録し、
// runTick を beginTickTiming()/endTickTiming() で挟んだ呼び出し側がまとめて回収する。
//
// 収集はモジュールグローバルな「現在のシンク」配列で行う。
// - 1 tick 中に並列プロバイダが多数の chatJSON を同時に走らせても、同じ配列に push されるだけで安全。
// - server は ticking ロックで、sim は逐次実行で、同時 tick は起きない（シンクが衝突しない）。
import type { LlmCallTiming } from "../domain/types.ts";

let current: LlmCallTiming[] | null = null;

/** この tick の計測を開始する（既存シンクは破棄）。runTick の直前に呼ぶ。 */
export function beginTickTiming(): void {
  current = [];
}

/** この tick で集めた計測を返してシンクを閉じる。runTick の直後に呼ぶ。 */
export function endTickTiming(): LlmCallTiming[] {
  const out = current ?? [];
  current = null;
  return out;
}

/** 1回の LLM 呼び出しを記録する。シンクが開いていなければ握りつぶす（計測対象外の呼び出し）。 */
export function recordTiming(entry: LlmCallTiming): void {
  current?.push(entry);
}
