// 場所（背景）絵生成スクリプト（OpenAI gpt-image-2）
//
// 使い方:
//   bun scripts/gen-place-art.ts                 # 全ての場所を生成
//   bun scripts/gen-place-art.ts kamogawa ohara  # 指定の場所だけ
//
// 必要な環境変数: OPENAI_API_KEY（.env から bun が自動ロード）
// 出力先: assets/places/<id>.webp
//
// ※ 本番ループの LLM 方針（CLAUDE.md）とは別系統。画像生成は OpenAI 従量課金 API を使う。
//   キャラ絵（gen-character-art.ts）と違い、場所は「背景込み・人物なし・横長」で生成する。
//   背景込みは gpt-image-2 が既定（透過は不要なので gpt-image-1 は使わない）。

import { mkdir, unlink } from "node:fs/promises";
import { $ } from "bun";
import { PLACES } from "../src/domain/places.ts";

const MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2";
// 場所はバナー的に見せたいので横長（gpt-image-2 は 1536x1024 に対応）。
const SIZE = process.env.IMAGE_SIZE ?? "1536x1024";
const OUT_DIR = new URL("../assets/places/", import.meta.url).pathname;

// 共通の画風指定。キャラ絵（明るくポップ）と世界観を揃えつつ、人物は入れない背景画にする。
const STYLE =
  "Bright, pop, colorful Japanese anime background art. Scenic landscape only, " +
  "no people, no characters, no text, no watermark. " +
  "Warm inviting Studio-Ghibli-like atmosphere, vivid saturated palette, soft cheerful lighting, " +
  "clean crisp painterly rendering, a gentle touch of magical spirit-world (ayakashi) fantasy.";

async function generate(id: string, name: string, prompt: string, apiKey: string) {
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
    throw new Error(`[${id}] OpenAI API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${id}] レスポンスに b64_json がありません: ${JSON.stringify(json).slice(0, 200)}`);

  // PNG(b64) を cwebp で WebP（q80）に変換して保存（軽量化）。
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
  const places = PLACES.filter((p) => filter.size === 0 || filter.has(p.id));
  if (places.length === 0) {
    console.error(`✗ 対象の場所なし。指定: ${[...filter].join(", ") || "(なし)"}`);
    process.exit(1);
  }

  for (const p of places) {
    const prompt = `${p.appearance}\n\n${STYLE}`;
    console.log(`… ${p.name} (${p.id}) を ${MODEL} で生成中`);
    await generate(p.id, p.name, prompt, apiKey);
  }
  console.log(`\n完了: ${places.length} 箇所ぶんを ${OUT_DIR} に保存しました。`);
}

main();
