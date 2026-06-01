// ココロ。他者から「された経験」が積もって芽生える内面の傾き。種類を増やせる器（現状は利他の心の1種）。全キャラが持つ。
// ハル専用の会得式スキル（回帰永続パッシブ）とは別系統。利他パラメータ等は直接いじらず、
// 段階に応じた一文をプロンプトへ注入して行動傾向を動かす。
// 受領カウントは Character.soulCounters（kind.id → 回数）に汎用的に持つ＝心を足してもスキーマ不変。
// 周またぎ持ち越しは主人公ハルだけ（campaign.ts の freshWorldFor / recordTick 参照）。
import type { Character } from "./types.ts";

export interface SoulStage {
  /** 段階。1→2→3 と深まる */
  level: number;
  /** この段階に入る受領回数の下限 */
  threshold: number;
  /** その段階の名前（心ごとに語感を変える） */
  label: string;
  /** プロンプトに注入する一文（その段階の心の傾き） */
  prompt: string;
}

export interface SoulKind {
  /** 心の識別子。soulCounters のキーになる（永続化される＝安易に変えない） */
  id: string;
  /** 表示名（例: 利他の心） */
  label: string;
  /** 一覧ページ用のアイコン */
  icon: string;
  /** この心が積もる経験の説明（一覧ページ用） */
  source: string;
  /** 深まる段階（threshold 昇順） */
  stages: SoulStage[];
}

/**
 * ココロの種類。閾値は全種類そろえて 3 / 5 / 8（バランス調整で動かしてよい）。
 * トリガー（どの経験で積もるか）は engine.ts の受領ループが bumpSoul で刻む。
 */
export const SOUL_KINDS: SoulKind[] = [
  {
    id: "altruism",
    label: "利他の心",
    icon: "💞",
    source: "霊力を分けてもらう（share を受ける）",
    stages: [
      {
        level: 1,
        threshold: 3,
        label: "芽生え",
        prompt:
          "これまで幾度か、誰かに霊力を分けてもらった。受けた温もりが胸に残り、自分も誰かに分け与えたい——そんな心がかすかに芽生えはじめている。",
      },
      {
        level: 2,
        threshold: 5,
        label: "温む",
        prompt:
          "幾度も分けてもらった温もりが、はっきりと心を温めている。困っている者がいれば分け与え、語りかけ、庇いたい——そんな利他の傾きが強まっている。",
      },
      {
        level: 3,
        threshold: 8,
        label: "満ちる",
        prompt:
          "受けた優しさが満ち、自分のことより他者を気にかけるのが当たり前になっている。分け与え・語らい・誰かを庇う行いに、ためらいなく心が向かう。",
      },
    ],
  },
];

const KIND_BY_ID = new Map<string, SoulKind>(SOUL_KINDS.map((k) => [k.id, k]));

/** 受領回数から到達している最高段階を返す。まだどの段階にも届いていなければ null。 */
export function soulStageOf(kind: SoulKind, count: number): SoulStage | null {
  let current: SoulStage | null = null;
  for (const s of kind.stages) {
    if (count >= s.threshold) current = s;
  }
  return current;
}

/** ある心の受領を1つ刻む。未定義キーは 0 から始める（soulCounters は疎な Record）。 */
export function bumpSoul(c: Character, kindId: string): void {
  c.soulCounters[kindId] = (c.soulCounters[kindId] ?? 0) + 1;
}

/** プロンプトに注入するココロのブロック。芽生えた心それぞれの一文を改行で連ねる（無ければ空）。 */
export function soulBlock(c: Character): string {
  const lines: string[] = [];
  for (const kind of SOUL_KINDS) {
    const count = c.soulCounters[kind.id] ?? 0;
    const stage = soulStageOf(kind, count);
    if (stage) lines.push(`ココロ（${kind.label}・${stage.label}）— ${stage.prompt}`);
  }
  return lines.join("\n");
}

export function findSoulKind(id: string): SoulKind | undefined {
  return KIND_BY_ID.get(id);
}
