# API エンドポイントと UI ページ

## API

読み取り専用（観るだけ画面）。進行はサーバ内部の自走ワーカーだけが行い、状態を変える API は公開しない。

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/state` | 現在の世界状態と現在の回帰ぶんのログ・年代記 |
| GET | `/api/loops/:loop` | 指定した回帰の物語（その周の ticks をオンデマンドに） |
| GET | `/api/character/:id` | キャラの全周横断の軌跡（`char_metrics` の薄い行） |
| GET | `/api/health` | バックエンド疎通とモデル名 |

### アセット配信

| パス | 説明 |
|---|---|
| `/assets/characters/:file` | キャラ絵（WebP/PNG。サニタイズ済み・Cache-Control 1日） |
| `/assets/places/:file` | 場所絵（同上） |
| `/assets/title.webp` | タイトルロゴ（日本語版。`/assets/title-en.webp` は英語版） |
| `/assets/og.jpg` | OGP シェアカード画像（title-en.webp の 1.91:1 クロップ。index.html の og:image が参照。LinkedIn が WebP 非対応のため webp ルールの例外で JPG） |

## UI ページ（ハッシュルーティング）

`src/web/router.ts` でハッシュベースのルーティング。

| ハッシュ | ページ | コンポーネント |
|---|---|---|
| `#/` | ホーム（現在の回帰） | `FrontStage` / `TickLog` / `CharacterCard` 等 |
| `#/loop/:n` | 第N回帰の物語 | `LoopPage` |
| `#/char/:id` | キャラ別ページ（全周横断） | `CharacterPage` |
| `#/skills` | スキル一覧（獲得式・永続） | `SkillsPage` |
| `#/souls` | ココロ一覧（利他の心・全キャラの現状） | `SoulsPage` |

各回帰へは、ホームの日付欄および回帰ページ右肩にある「第N回帰」セレクト（`LoopSelect`）からジャンプする。
最新（進行中）の回帰を選ぶとホーム（`#/`）へ飛ぶ。旧・回帰一覧ページ（`#/loops`）は廃止。

### 観客ビューと楽屋ビュー

ホーム画面には2つの表示モードがある。SiteNav（ホーム＝表／ステータス＝裏／デバッグ＝ログ）で切替。

- **観客ビュー（`FrontStage.tsx`）**: 公開サイトで観客に見せる表。数値・囁き・気分・実り操作・演出意図は出さない。演出家由来で出るのは `director.narration` だけ。
- **楽屋ビュー（`TickLog.tsx`）**: 開発・観察用の裏。intent（`演出: …`）・囁き・実り操作の数値・LLM時間などが見える。
