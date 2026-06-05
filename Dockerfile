# Railway 本番イメージ（docs/deploy.md 参照）
# - bun ランタイムをそのまま使う（Bun.serve / bun:sqlite / HTML import を無改造で動かす）
# - LLM バックエンドは Claude Code CLI（`claude -p`）。認証はランタイム env
#   CLAUDE_CODE_OAUTH_TOKEN（`claude setup-token` で発行したサブスク OAuth トークン）。
#   ※ ANTHROPIC_API_KEY は絶対に env に置かない（従量課金に倒れる。CLAUDE.md 参照）
FROM oven/bun:1.3.11

# Claude Code CLI のネイティブインストールに必要な curl / 証明書
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Claude Code CLI（スタンドアロンバイナリ。node 不要）
# 本番は「fin まで放置」運用（docs/deploy.md）なので、本番で動作確認済みの
# バージョンに固定して、再ビルド時に未検証の最新版が入るのを防ぐ
RUN curl -fsSL https://claude.ai/install.sh | bash -s 2.1.165
ENV PATH="/root/.local/bin:${PATH}"

# 世界の暦・表示は日本時間前提
ENV TZ=Asia/Tokyo

WORKDIR /app

# 依存を先に入れてレイヤーキャッシュを効かせる。
# devDependencies も必要（起動時の drizzle-kit push と HTML import の tailwind プラグイン）
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .

# data/ は Railway のボリュームを /app/data にマウントする（DB は本番で新規作成）。
# 起動時に最初に走る drizzle-kit push はディレクトリを自分で作らないため、
# ボリューム無しでも起動できるようここで作っておく（マウント時はボリュームが上書き）
RUN mkdir -p data
# Railway の healthcheck は PORT 変数のポートを叩くため、サービス変数 PORT=5566 と
# package.json start の PORT=5566 と必ず揃えること（EXPOSE 自体は宣言のみ）
EXPOSE 5566
CMD ["bun", "run", "start"]
