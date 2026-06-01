# キャラ絵 / 画像生成メモ

## 使うモデル
- 画像生成は OpenAI の画像 API（従量課金）を使う。LLM 本体の方針（CLAUDE.md）とは別系統。
- 認証は `OPENAI_API_KEY`（`.env`／bun が自動ロード）。
- モデルは **用途で使い分ける**:
  - **`gpt-image-2`（デフォルト）** … 通常はこちら。背景込みの絵。
  - **`gpt-image-1` + 透過** … 背景透過 PNG が欲しいときはこちら（gpt-image-2 は透過非対応）。
- 現状のキャラ絵は **`gpt-image-1` で透過＋ポップ画風**を採用している。

## 生成スクリプト
`scripts/gen-character-art.ts`

```sh
# デフォルト（gpt-image-2・背景込み）
bun scripts/gen-character-art.ts            # 全キャラ
bun scripts/gen-character-art.ts haru nagi  # 指定キャラだけ

# 透過＋ポップ（gpt-image-1）← いまのキャラ絵はこれで生成
IMAGE_MODEL=gpt-image-1 IMAGE_TRANSPARENT=1 bun scripts/gen-character-art.ts
```

- env で切替: `IMAGE_MODEL`（既定 `gpt-image-2`）、`IMAGE_TRANSPARENT=1`（透過オン）。
- キャラ定義（`src/domain/characters.ts`）の core / talent をもとに、スクリプト内の
  `LOOKS` で見た目プロンプトを組み立てる。画風は共通の `STYLE_BASE`（**明るくポップ・かわいい
  アニメ調**）で統一。
- 出力先: `assets/characters/<id>.webp`（後述の通り PNG→WebP に変換して保存）。

## 透過まわりの知見（実機確認: 2026-05）
- **`gpt-image-2` は `background:"transparent"` 非対応**
  （`400 image_generation_user_error` / `param:"background"`）。
- **`gpt-image-1` は透過に対応**。`background:"transparent"` を付けて投げると、
  アルファ付き（`srgba`）の画像が返ることを実機で確認済み。
  → 背景透過のキャラ立ち絵が欲しいなら `gpt-image-1` を使う。

## その他の API 知見
- レスポンスは常に `data[0].b64_json`（`url` は返らない）。base64 を decode して保存する。
  `response_format` の指定は不要。→ DALL·E 3 系の「URL が返る前提」のコードは流用不可。
- `size` は `1024x1024` を使用（正方形）。
- 生成は 1 枚あたり数十秒。並列はレート制限に当たり得るので逐次実行にしている。
- リトライ機構はない。失敗したらそのキャラだけ id 指定で再実行する。

## 出力ファイル（WebP 変換）
- 生成元 PNG は 1 枚 ~1.5〜1.9MB と重いので、**`cwebp -q 80` で WebP に変換して保存する**
  （スクリプトが自動で実施: PNG を一時保存 → `cwebp` → `.webp` 出力 → 一時 PNG 削除）。
  - 結果 ~85〜250KB まで縮む（約 90〜95% 減）。透過（アルファ）も保持される。
  - 依存: `cwebp`（macOS は `brew install webp`）。
- 画像は `assets/` 配下。`data/`（SQLite）とは別で、`.gitignore` 対象外（リポジトリに含めてよい素材）。

## Web への組み込み状況
- 配信: `server.ts` に `/assets/characters/:file` ルートあり（PNG/WebP を返す。
  ファイル名はサニタイズしてパストラバーサルを防止、`Cache-Control` 1 日）。
- 表示: **キャラページ（`CharacterPage.tsx`）にプロフィール画像として表示済み**
  （`/assets/characters/<id>.webp`、絵が無いキャラは `onError` で非表示）。
- `CharacterCard.tsx`（ホームのカード）への組み込みは未対応。

## 既存のキャラ
| id | 名前 | 役どころ |
|----|------|----------|
| haru | ハル | 霊脈の独占を憎む、冷静な祓いの妖（観の眼） |
| nagi | ナギ | 見捨てられを恐れる、明るい結びの妖・巫女筋（結の力） |
| kai | カイ | 霊を喰らう餓えた半妖、誰も信じない（奪命） |

## 場所（背景）絵
- スクリプト: `scripts/gen-place-art.ts`。場所定義（`src/domain/places.ts` の各 `appearance`）をもとに背景画を生成する。
  ```sh
  bun scripts/gen-place-art.ts                 # 全ての場所
  bun scripts/gen-place-art.ts kamogawa ohara  # 指定の場所だけ
  ```
- キャラ絵と違い **背景込み・人物なし・横長**で作る。既定は `gpt-image-2`・`1536x1024`（透過不要なので gpt-image-1 は使わない）。env で `IMAGE_MODEL` / `IMAGE_SIZE` を切替可能。
- 画風は共通の `STYLE`（キャラ絵と揃えた明るくポップなアニメ調・人物/文字なし）で統一。
- 出力先: `assets/places/<id>.webp`（PNG→WebP 変換）。
- 配信: `server.ts` に `/assets/places/:file` ルートあり（キャラ絵と同様にサニタイズ）。
- 表示: 楽屋ビューの「京都の地図」（`PlacesMap.tsx`）で各場所カードのサムネとして表示（絵が無い場所は `onError` で画像のみ非表示）。
