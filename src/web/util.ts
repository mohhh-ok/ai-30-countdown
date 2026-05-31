// 表示用の共有ヘルパ（App と各ページで使い回す）。
import type { TickResult } from "../domain/types.ts";
import { createInitialCharacters } from "../domain/characters.ts";
import { findSkill } from "../domain/skills.ts";

const CHAR_NAMES = new Map(
  createInitialCharacters().map((c) => [c.id, c.name] as const),
);

/** キャラ id → 名前（未知なら id をそのまま） */
export const nameOfId = (id: string): string => CHAR_NAMES.get(id) ?? id;

/** スキル id → 表示名（未知なら id をそのまま） */
export const skillName = (id: string): string => findSkill(id)?.name ?? id;

/** その tick の回帰番号（旧データは 1 とみなす） */
export const loopOf = (t: TickResult): number => t.loop ?? 1;

/** ログから指定回帰ぶんだけを日付順に取り出す */
export function ticksOfLoop(log: TickResult[], loop: number): TickResult[] {
  return log.filter((t) => loopOf(t) === loop);
}

/** ログに含まれる回帰番号を昇順で返す */
export function loopNumbers(log: TickResult[]): number[] {
  const s = new Set<number>();
  for (const t of log) s.add(loopOf(t));
  return [...s].sort((a, b) => a - b);
}
