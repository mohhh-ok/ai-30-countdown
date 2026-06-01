// drizzle-kit 設定。スキーマは src/schema.ts、対象は SQLite ファイル（既定 data/world.db）。
// 運用は push（npm run db:push）。本番は壊れて良い前提なので generate/migrate 履歴は持たない。
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DB_PATH ?? "data/world.db",
  },
});
