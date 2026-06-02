# アーキテクチャ

## ディレクトリ構成

```
src/
  domain/           世界モデルとルール
    types.ts          ドメイン型定義（Action / Weather / WorldState 等）
    characters.ts     登場人物の初期定義・抗体/気分の初期値
    places.ts         場所の定義・隣接グラフ・移動ユーティリティ
    engine.ts         1ティックの決定論処理（負荷・収支・クランプ・死亡・段階）
    rules.ts          パラメータ変動のルール（報酬・抗体・気分）
    events.ts         天候・災害・豊穣の抽選と効果（disasterIntensity / creepingLoad）
    campaign.ts       年代記（Chronicle）・回帰モデル・スキル/ロスター管理
    skills.ts         会得式スキルのレジストリ（条件・効果・進捗計測）
    soul.ts           ココロ（利他の心）の段階管理
    highlights.ts     見せ場・メタイベントの抽出（ルールベース）
  llm/              LLM バックエンド切替・プロンプト・判断
    backend.ts        バックエンド切替層（claude-code / ollama）
    decide.ts         行動決定プロンプト・LLM 呼び出し
    dialogue.ts       会話劇の生成（1発言ずつ交互）
    director.ts       演出家（天候・実り操作・ナレーション）
    guardian.ts       守護神（囁きの生成）
    director_guardian.ts  演出家+守護神の統合呼び出し
    prompt.ts         共通プロンプトユーティリティ
    mock.ts           モック（LLM 不要の簡易ロジック）
    ollama.ts         Ollama クライアント
    onecall.ts        1プロセス起動で複数判断を並列処理
    timing.ts         LLM 呼び出しの計時・記録
    log.ts            LLM ログ
  web/              React UI
    index.html        エントリ HTML
    main.tsx          React マウント
    App.tsx           ルーティング・レイアウト・SiteNav・TitleBlock
    router.ts         ハッシュルーター（#/ / #/loops / #/char/:id 等）
    styles.css        手書き CSS（暗幕・背景絵・毛筆・回帰アニメ等）
    charTheme.ts      キャラ別テーマ色
    util.ts           フロント共通ユーティリティ
    components/       共通コンポーネント
      FrontStage.tsx    観客ビュー（配信で見せる表）
      TickLog.tsx       楽屋ビュー（開発・観察用の裏）
      CharacterCard.tsx キャラカード
      CharAvatar.tsx    キャラアバター
      ParamBar.tsx      パラメータバー
      PlacesMap.tsx     京都の地図（場所サムネ）
      SceneFX.tsx       three.js 粒子演出
      Highlights.tsx    見せ場・メタイベント表示
    pages/            ページコンポーネント
      CharacterPage.tsx キャラ別ページ（全周横断の軌跡）
      LoopsPage.tsx     回帰一覧
      LoopPage.tsx      特定回帰の物語
      SkillsPage.tsx    スキル一覧
      SoulsPage.tsx     ココロ一覧
  schema.ts         Drizzle テーブル定義（SQLite スキーマの正）
  db.ts             DB 読み書き（全て drizzle 経由）
  server.ts         Bun.serve（API + フロント配信 + 自走ワーカー）
  sim.ts            ヘッドレス CLI（bun run sim）
scripts/
  audit-reachability.ts   到達可能性アウディット
  bench-decide.ts         行動決定のベンチマーク
  gen-character-art.ts    キャラ絵生成
  gen-place-art.ts        場所絵生成
  gen-title-art.ts        タイトルロゴ生成
assets/
  characters/       キャラ絵（WebP）
  places/           場所絵（WebP）
  title.webp        タイトルロゴ
data/
  world.db          SQLite データベース（.gitignore 対象）
```

## 技術スタック

| レイヤー | 技術 |
|---|---|
| ランタイム | [bun](https://bun.sh) 1.3+ |
| 言語 | TypeScript |
| DB | SQLite（bun:sqlite） |
| ORM | Drizzle ORM（drizzle-orm / drizzle-kit） |
| フロントエンド | React 19 + Tailwind v4（ハイブリッド） |
| 3D 演出 | three.js（観客ビューの粒子エフェクト） |
| LLM | Claude Code CLI / Ollama（切替可能） |
| 画像生成 | OpenAI gpt-image-1 / gpt-image-2 |

## スタイリング（CSS / Tailwind ハイブリッド）

CSS は `src/web/styles.css` の手書きが主体。これに加えて **Tailwind v4 をハイブリッドで併用**する。

- `src/web/styles.css` 先頭の `@import "tailwindcss";` と、`bunfig.toml` の `[serve.static] plugins = ["bun-plugin-tailwind"]` で、bun の HTML import バンドラ（`server.ts` の `import index from "./web/index.html"`）にそのまま乗る。別ビルドステップは不要で、`bun dev` の HMR も効く。
- 使い分け: 新規・小物パーツは JSX に Tailwind ユーティリティで書き、既存の凝った演出（暗幕・背景絵・毛筆・回帰アニメ等）は `styles.css` に温存する。テーマ色は CSS 変数を arbitrary value（例: `bg-[var(--accent)]`）で参照する。
- 注意: `Bun.build` 直叩き＋ `bun-plugin-tailwind` は bun 1.3.11 で segfault する（Bun 側のバグ）。ビルドは `Bun.serve` / `bun dev` 経路で行う（本アプリは serve 経路なので影響なし）。
