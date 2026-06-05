// 大禍（the Calamity）絵生成スクリプト（OpenAI gpt-image-2）
//
// 結末バリアントごとに1枚ずつ作る（観客ビューの大禍演出の上に帯として添える）:
//   arrival … 大禍、来たる（結末前の共通カット・人物なし）
//   lost    … 防げず京は呑まれた（人物なし・禍々しい）
//   solo    … 防げたがハル独りの暁（ハルのキャラ絵を参照して登場させる）
//   saved   … 全員が生き残った暁（全キャラ絵を参照して登場させる）
//
// 使い方:
//   bun scripts/gen-calamity-art.ts            # 全バリアント
//   bun scripts/gen-calamity-art.ts solo       # 指定バリアントだけ
//   bun scripts/gen-calamity-art.ts solo saved
//
// 必要な環境変数: OPENAI_API_KEY（.env から bun が自動ロード）
// 出力先: assets/calamity.webp / calamity-lost.webp / calamity-solo.webp / calamity-saved.webp
//
// ※ 本番ループの LLM 方針（CLAUDE.md）とは別系統。画像生成は OpenAI 従量課金 API を使う。
//   キャラを登場させる solo/saved は images/edits に既存キャラ絵を「参照画像」として渡す。
//   gpt-image-2 が edits（複数参照）に対応するかは未確認 → 弾かれたらエラーをそのまま投げる
//   （CLAUDE.md: 失敗は握りつぶさず露出させる。勝手に別モデルへ切り替えない）。

import { mkdir, unlink, readFile } from "node:fs/promises";
import { $ } from "bun";

const MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2";
// 演出の上に帯として敷くので横長（gpt-image-2 は 1536x1024 に対応）。
const SIZE = process.env.IMAGE_SIZE ?? "1536x1024";
const ASSETS = new URL("../assets/", import.meta.url).pathname;
const CHARS = new URL("../assets/characters/", import.meta.url).pathname;

// 共通の画風。キャラ絵・場所絵（明るくポップなアニメ調）と世界観を揃える。
const STYLE_BASE =
  "Bright, pop, colorful Japanese anime art. Vivid saturated palette, " +
  "clean crisp painterly rendering, a gentle touch of magical spirit-world (ayakashi) fantasy. " +
  "Wide cinematic banner composition. No text, no watermark.";

type Variant = {
  id: string; // 引数・ログ用
  file: string; // 出力ファイル名（assets/ 直下）
  subject: string;
  refs?: string[]; // 参照キャラ絵（assets/characters/ 内）。あれば images/edits を使う。
};

const VARIANTS: Variant[] = [
  {
    id: "arrival",
    file: "calamity.webp",
    subject:
      "A great cosmic calamity descending upon old Heian-era Kyoto: an enormous ominous comet / " +
      "falling blazing star streaking across the wide sky, trailing a long luminous tail of pink and " +
      "crimson fire, swirling spirit-energy clouds, the silhouette of distant mountains and traditional " +
      "rooftops far below. Scenic only, no people. Dramatic, awe-inspiring, the moment the Calamity arrives.",
  },
  {
    id: "lost",
    file: "calamity-lost.webp",
    subject:
      "The Calamity strikes and devours Kyoto: the blazing crimson comet crashing down, dark ominous " +
      "spirit-fire engulfing the old town, collapsing rooftops and a swallowed skyline under a violet-black " +
      "stormy sky. Scenic only, no people. Foreboding and catastrophic, yet rendered in saturated anime color.",
  },
  {
    id: "solo",
    file: "calamity-solo.webp",
    refs: ["haru.webp"],
    subject:
      "After the Calamity has been repelled: a quiet, lonely dawn over a scarred, half-ruined Kyoto. " +
      "The single character shown in the reference image stands alone, small, within a faint protective " +
      "barrier of soft light, gazing at the pale sunrise. Melancholy, solitary — the dawn came to her alone. " +
      "Keep her appearance faithful to the reference image.",
  },
  {
    id: "saved",
    file: "calamity-saved.webp",
    refs: ["haru.webp", "nagi.webp", "kai.webp", "sora.webp", "shiori.webp"],
    subject:
      "After the Calamity has been repelled: a warm, hopeful dawn over a saved Kyoto, lanterns of the " +
      "welcoming-fire glowing. All of the characters shown in the reference images stand together side by " +
      "side, reunited, facing the bright sunrise. Joyful, warm, a grand finale. " +
      "Keep each character's appearance faithful to their reference image.",
  },
];

async function saveWebp(file: string, b64: string) {
  // PNG(b64) を cwebp で WebP（q80）に変換して保存（軽量化）。
  const tmpPng = `${ASSETS}${file}.tmp.png`;
  const outPath = `${ASSETS}${file}`;
  await Bun.write(tmpPng, Buffer.from(b64, "base64"));
  await $`cwebp -quiet -q 80 ${tmpPng} -o ${outPath}`;
  await unlink(tmpPng);
  return outPath;
}

function pickB64(json: unknown, id: string): string {
  const data = (json as { data?: { b64_json?: string }[] }).data;
  const b64 = data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${id}] レスポンスに b64_json がありません: ${JSON.stringify(json).slice(0, 200)}`);
  return b64;
}

// 参照画像なし: text-to-image（images/generations）。
async function genFromText(v: Variant, apiKey: string) {
  const prompt = `${v.subject}\n\n${STYLE_BASE}`;
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, n: 1 }),
  });
  if (!res.ok) throw new Error(`[${v.id}] generations ${res.status}: ${await res.text()}`);
  return pickB64(await res.json(), v.id);
}

// 参照画像あり: image-to-image（images/edits に複数キャラ絵を渡す）。
async function genFromRefs(v: Variant, apiKey: string) {
  const prompt = `${v.subject}\n\n${STYLE_BASE}`;
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("size", SIZE);
  for (const ref of v.refs!) {
    const buf = await readFile(`${CHARS}${ref}`);
    // edits は同名フィールド image[] を複数添付して複数参照画像を渡す。
    form.append("image[]", new Blob([buf], { type: "image/webp" }), ref);
  }
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`[${v.id}] edits ${res.status}: ${await res.text()}`);
  return pickB64(await res.json(), v.id);
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("✗ OPENAI_API_KEY が未設定です（.env を確認してください）");
    process.exit(1);
  }

  await mkdir(ASSETS, { recursive: true });

  const filter = new Set(process.argv.slice(2));
  const targets = VARIANTS.filter((v) => filter.size === 0 || filter.has(v.id));
  if (targets.length === 0) {
    console.error(`✗ 対象バリアントなし。指定可能: ${VARIANTS.map((v) => v.id).join(", ")}`);
    process.exit(1);
  }

  for (const v of targets) {
    const how = v.refs ? `edits・参照[${v.refs.join(", ")}]` : "generations";
    console.log(`… ${v.id} を ${MODEL}（${SIZE}・${how}）で生成中`);
    const b64 = v.refs ? await genFromRefs(v, apiKey) : await genFromText(v, apiKey);
    const out = await saveWebp(v.file, b64);
    console.log(`✓ ${v.id} → ${out}`);
  }
  console.log(`\n完了: ${targets.length} 枚を ${ASSETS} に保存しました。`);
}

main();
