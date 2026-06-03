// 英語版タイトルロゴ生成スクリプト（OpenAI gpt-image-1 / images/edits）
//
// 使い方:
//   bun scripts/gen-title-art-en.ts            # 既存 assets/title.webp を入力に英語版を生成
//
// 必要な環境変数: OPENAI_API_KEY（.env から bun が自動ロード）
// 入力: assets/title.webp（日本語ロゴ）
// 出力先: assets/title-en.webp
//
// 方針: ゼロから別構図で作り直すのではなく、既存ロゴ（背景・構図・配色）を維持したまま
//   中央のタイトル文字だけ日本語 → 英語へ差し替える。images/edits（元画像＋プロンプト）を使う。
//
// ※ 既知の弱点: gpt-image 系はテキスト字形が崩れやすい。英字でも一発で綺麗に出る保証はない。
//   崩れたら握りつぶさず結果を見て判断する（必要なら再生成・プロンプト調整）。

import { mkdir, unlink, readFile } from "node:fs/promises";
import { $ } from "bun";

// edits は gpt-image-1 を使う（gpt-image-2 の edits 対応は未確認。-1 は edits 公式対応）。
const MODEL = process.env.IMAGE_MODEL ?? "gpt-image-1";
const SIZE = process.env.IMAGE_SIZE ?? "1536x1024";
const ASSETS_DIR = new URL("../assets/", import.meta.url).pathname;
const IN_PATH = `${ASSETS_DIR}title.webp`;
const ID = "title-en";

// 編集プロンプト: 構図・配色・背景はそのまま、中央のタイトル文字だけ英語へ差し替える指示。
const PROMPT =
  "Keep the overall composition, background art, color palette, lighting and style of this image " +
  "EXACTLY the same. Only replace the large central Japanese title text with the English title " +
  '"A 30-DAY COUNTDOWN". Render the English title huge, bold and dominant in the center, in a ' +
  "powerful brush-stroke display typeface, highly legible and correctly spelled, in radiant glowing " +
  "gold with strong outline and depth, matching the look of the original title. Do not add any other " +
  "text. No Japanese characters anywhere. No people, no characters, no watermark.";

async function generate(apiKey: string) {
  // 入力画像（webp）を読み、multipart の image フィールドに載せる。
  const inBuf = await readFile(IN_PATH);
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", PROMPT);
  form.append("size", SIZE);
  form.append("n", "1");
  form.append("image", new Blob([inBuf], { type: "image/webp" }), "title.webp");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[${ID}] OpenAI API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${ID}] レスポンスに b64_json がありません: ${JSON.stringify(json).slice(0, 200)}`);

  // PNG(b64) を cwebp で WebP（q80）に変換して保存（軽量化）。
  const tmpPng = `${ASSETS_DIR}${ID}.tmp.png`;
  const outPath = `${ASSETS_DIR}${ID}.webp`;
  await Bun.write(tmpPng, Buffer.from(b64, "base64"));
  await $`cwebp -quiet -q 80 ${tmpPng} -o ${outPath}`;
  await unlink(tmpPng);
  console.log(`✓ 英語版タイトルロゴ → ${outPath}`);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("✗ OPENAI_API_KEY が未設定です（.env を確認してください）");
    process.exit(1);
  }

  await mkdir(ASSETS_DIR, { recursive: true });
  console.log(`… ${IN_PATH} を入力に英語版ロゴを ${MODEL}（${SIZE}）で生成中`);
  await generate(apiKey);
  console.log(`\n完了: ${ASSETS_DIR}${ID}.webp に保存しました。`);
}

main();
