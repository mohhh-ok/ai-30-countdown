# シークレット検査（gitleaks）

API キー等の漏洩を防ぐため [gitleaks](https://github.com/gitleaks/gitleaks) を使う。pre-commit でステージ済み差分を検査し、検出時はコミットを中止する。

## セットアップ

フック実体は `.githooks/pre-commit`（リポジトリ管理下）。クローン直後に1回だけ実行:

```sh
brew install gitleaks                 # 未インストールなら
git config core.hooksPath .githooks   # フック有効化
```

Windows 等で実行権限が落ちた場合は `chmod +x .githooks/pre-commit` も実行する。

## 手動スキャン

```sh
bun run secrets          # 全履歴をスキャン
bun run secrets:staged   # ステージ済み差分のみ
```

## 除外

誤検知は該当行末に `gitleaks:allow` を付けるか `.gitleaks.toml` で除外する。

## CI

`.github/workflows/gitleaks.yml` が push / PR で全履歴を再スキャンする（手元のフックをすり抜けても CI で検出）。
