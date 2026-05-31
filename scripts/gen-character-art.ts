// キャラ絵生成スクリプト（OpenAI gpt-image-2）
//
// 使い方:
//   bun scripts/gen-character-art.ts            # 全キャラ生成
//   bun scripts/gen-character-art.ts haru nagi  # 指定キャラだけ
//
// 必要な環境変数: OPENAI_API_KEY（.env から bun が自動ロード）
// 出力先: assets/characters/<id>.png
//
// ※ 本番ループの LLM 方針（CLAUDE.md）とは別系統。画像生成は OpenAI 従量課金 API を使う。

import { mkdir, unlink } from "node:fs/promises";
import { $ } from "bun";
import { createInitialCharacters } from "../src/domain/characters.ts";

// モデル / 透過は env で切替可能:
//   IMAGE_MODEL=gpt-image-1 IMAGE_TRANSPARENT=1 bun scripts/gen-character-art.ts
// ※ 透過（background:"transparent"）は gpt-image-1 系のみ対応。gpt-image-2 は 400 を返す。
const MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2";
const TRANSPARENT =
  process.env.IMAGE_TRANSPARENT === "1" || process.env.IMAGE_TRANSPARENT === "true";
const SIZE = "1024x1024";
const OUT_DIR = new URL("../assets/characters/", import.meta.url).pathname;

// 共通の画風指定（ポップ・明るい・かわいい）。各キャラの core / talent に味付けする。
const STYLE_BASE =
  "Bright, pop, colorful Japanese anime illustration. Cute, friendly, approachable character, " +
  "bust-up portrait, clean crisp cel-shading, vivid saturated palette, cheerful soft lighting, " +
  "rounded soft shapes, playful modern manga style with little sparkles and cute accents. " +
  "Single character, centered. No text, no watermark.";
const STYLE = TRANSPARENT
  ? `${STYLE_BASE} Plain flat transparent background.`
  : `${STYLE_BASE} Simple bright pastel background with cute decorative motifs.`;

// ※ 各キャラの見た目プロンプトは characters.ts の `appearance` に統合済み。
//   共通画風（STYLE）だけこのスクリプト側が付与する。

async function generate(id: string, name: string, prompt: string, apiKey: string) {
  const body: Record<string, unknown> = { model: MODEL, prompt, size: SIZE, n: 1 };
  if (TRANSPARENT) body.background = "transparent"; // gpt-image-1 系のみ有効

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
    throw new Error(`[${id}] OpenAI API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${id}] レスポンスに b64_json がありません: ${JSON.stringify(json).slice(0, 200)}`);

  // gpt-image-2 は PNG(b64) を返す。そのままだと 1 枚 ~1.5MB と重いので、
  // cwebp で WebP（q80）に変換して保存する（~95% 軽量化）。
  const tmpPng = `${OUT_DIR}${id}.tmp.png`;
  const outPath = `${OUT_DIR}${id}.webp`;
  await Bun.write(tmpPng, Buffer.from(b64, "base64"));
  await $`cwebp -quiet -q 80 ${tmpPng} -o ${outPath}`;
  await unlink(tmpPng);
  console.log(`✓ ${name} (${id}) → ${outPath}`);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("✗ OPENAI_API_KEY が未設定です（.env を確認してください）");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const filter = new Set(process.argv.slice(2));
  const chars = createInitialCharacters().filter((c) => filter.size === 0 || filter.has(c.id));
  if (chars.length === 0) {
    console.error(`✗ 対象キャラなし。指定: ${[...filter].join(", ") || "(なし)"}`);
    process.exit(1);
  }

  for (const c of chars) {
    const look = c.appearance;
    const prompt = `${look}\n\n${STYLE}`;
    console.log(`… ${c.name} (${c.id}) を ${MODEL} で生成中`);
    await generate(c.id, c.name, prompt, apiKey);
  }
  console.log(`\n完了: ${chars.length} 体ぶんを ${OUT_DIR} に保存しました。`);
}

main();
