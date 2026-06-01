// タイトルロゴ生成スクリプト（OpenAI gpt-image-2）
//
// 使い方:
//   bun scripts/gen-title-art.ts            # タイトルロゴを生成
//
// 必要な環境変数: OPENAI_API_KEY（.env から bun が自動ロード）
// 出力先: assets/title.webp
//
// ※ 本番ループの LLM 方針（CLAUDE.md）とは別系統。画像生成は OpenAI 従量課金 API を使う。
//   タイトルはバナー的に見せたいので横長（1536x1024）で生成する。背景込み＝gpt-image-2 が既定。
//
// ※ 既知の弱点: gpt-image 系は日本語テキストの字形が崩れやすい。まずは日本語タイトルを焼き込んだ版を
//   試作し、崩れるようなら英字ロゴ＋HTML 側で日本語を重ねる方針へ切り替える（握りつぶさず結果を見て判断）。

import { mkdir, unlink } from "node:fs/promises";
import { $ } from "bun";

const MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2";
const SIZE = process.env.IMAGE_SIZE ?? "1536x1024";
const OUT_DIR = new URL("../assets/", import.meta.url).pathname;
const ID = "title";

// タイトルロゴのプロンプト。世界観（妖＝あやかし／京都／霊脈）を、落ち着いた夜の京都トーンで。
// 派手なピンク／マゼンタは避け、藍・群青・墨・金を基調に上品にまとめる。
// 中央に大きく日本語タイトル「30日のカウントダウン」を据える。
const PROMPT =
  'A refined title logo banner for a Japanese game called "30日のカウントダウン" ' +
  '(meaning "30-Day Countdown"). Display the Japanese title text "30日のカウントダウン" ' +
  "huge, bold and dominant in the center, in a powerful brush-stroke Japanese display typeface, " +
  "highly legible and correctly written, rendered in radiant glowing gold with strong outline and depth. " +
  "Theme: an epic, dramatic ayakashi (Japanese spirit) Kyoto: towering torii and pagoda, " +
  "a brilliant blazing spiritual ley-line cutting through the scene, swirling spirit lights, " +
  "dynamic god-ray light beams breaking through clouds, a sense of an impending climax. " +
  "High-impact cinematic composition, high contrast, dramatic lighting, rich saturated yet refined " +
  "palette of deep indigo, brilliant gold, teal and luminous white. Keep it bright and striking, " +
  "not dark and not washed-out. Strictly avoid pink and magenta. Bold, epic, premium key-visual " +
  "rendering. " +
  "No people, no characters, no watermark. Composition leaves room around the title text.";

async function generate(prompt: string, apiKey: string) {
  const body: Record<string, unknown> = { model: MODEL, prompt, size: SIZE, n: 1 };

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[${ID}] OpenAI API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${ID}] レスポンスに b64_json がありません: ${JSON.stringify(json).slice(0, 200)}`);

  // PNG(b64) を cwebp で WebP（q80）に変換して保存（軽量化）。
  const tmpPng = `${OUT_DIR}${ID}.tmp.png`;
  const outPath = `${OUT_DIR}${ID}.webp`;
  await Bun.write(tmpPng, Buffer.from(b64, "base64"));
  await $`cwebp -quiet -q 80 ${tmpPng} -o ${outPath}`;
  await unlink(tmpPng);
  console.log(`✓ タイトルロゴ → ${outPath}`);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("✗ OPENAI_API_KEY が未設定です（.env を確認してください）");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`… タイトルロゴを ${MODEL}（${SIZE}）で生成中`);
  await generate(PROMPT, apiKey);
  console.log(`\n完了: ${OUT_DIR}${ID}.webp に保存しました。`);
}

main();
