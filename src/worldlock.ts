// world.db への「書き込み（進行）」を1プロセスに限るためのファイルロック。
//
// なぜ要るか: DB に書く writer は2系統ある——server.ts の自走ワーカー（startWorker）と
// sim.ts（--save/--resume）。これらを同じ data/world.db に二重起動すると、別々のメモリ上 campaign が
// それぞれ別の周（例: loop23 と loop24）を進め、同じ runId に tick を混ぜ書きして
// 日付が前後・欠落する（実際に loop20 の day19/20 が消えた）。ポートが違う組み合わせ
// （dev+sim 等）は Bun.serve のポート衝突では防げないため、ファイルロックで writer を排他する。
//
// 方針（CLAUDE.md「握りつぶし厳禁」）: 生きている保持者がいたら **throw して落とす**（黙って続行しない）。
// 死んだ保持者の残骸（stale lock）はクラッシュ跡なので奪取し、warn で可視化する。
// 読み取り専用（view = WORKER_AUTOSTART=0）はそもそも書かないのでロックを取らない＝併用してよい。
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const DB_PATH = process.env.DB_PATH ?? "data/world.db";
const LOCK_PATH = `${DB_PATH}.lock`;

interface LockInfo {
  pid: number;
  role: string;
  startedAt: string;
}

/** pid が生きているか。ESRCH なら死、EPERM は「居るが権限なし」＝生きている扱い。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(): LockInfo | null {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, "utf8")) as LockInfo;
  } catch {
    // 無い／壊れている＝有効な保持者なし
    return null;
  }
}

/**
 * 進行ロックを取得する。既に生きた別プロセスが保持していれば throw して起動を止める。
 * 同一プロセス（--hot のトップレベル再実行）からの再取得は冪等。
 * 取得後はプロセス終了時（exit / SIGINT / SIGTERM）に自動で解放する。
 * @param role ログ用の役割名（"server-worker" / "sim" など）
 */
export function acquireWorldLock(role: string): void {
  const existing = readLock();
  if (existing) {
    if (existing.pid === process.pid) {
      // 自分自身のロック（--hot の再評価など）。保持を継続するだけ。
      registerRelease();
      return;
    }
    if (pidAlive(existing.pid)) {
      throw new Error(
        `world.db の進行ロックは既に別プロセスが保持しています` +
          `（pid=${existing.pid} role=${existing.role} since ${existing.startedAt}）。\n` +
          `同じ ${DB_PATH} に書く writer（dev/start のワーカー・sim）を二重起動しようとしています。\n` +
          `対処: 既存プロセスを使う／止めてから起動し直す（kill ${existing.pid}）。` +
          `観るだけなら WORKER_AUTOSTART=0（bun run view）で書かずに併用できます。`,
      );
    }
    // 保持者の pid は死んでいる＝前回クラッシュの残骸。奪取する（可視化する）。
    console.warn(
      `⚠ stale な進行ロックを検出（pid=${existing.pid} role=${existing.role} since ${existing.startedAt}）。` +
        `保持者は既に終了済みのため奪取します。`,
    );
  }

  const info: LockInfo = { pid: process.pid, role, startedAt: new Date().toISOString() };
  writeFileSync(LOCK_PATH, JSON.stringify(info));
  registerRelease();
}

/**
 * 自分が保持しているロックファイルだけを消す。多重呼び出し安全。
 * 判定はモジュール変数ではなく「ロックファイルの pid が自分か」だけで行う
 * （--hot 再評価でモジュール状態がリセットされても、奪取後の他人のロックを誤消去しても安全なように）。
 */
export function releaseWorldLock(): void {
  const cur = readLock();
  if (!cur || cur.pid !== process.pid) return; // 無い／既に他人のものなら触らない
  try {
    unlinkSync(LOCK_PATH);
  } catch (err) {
    // ENOENT（既に消えている）は正常系。それ以外は握りつぶさず可視化する。
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`⚠ 進行ロックファイルの削除に失敗しました（${LOCK_PATH}）: ${err}`);
    }
  }
}

// exit/シグナルのハンドラはプロセスにつき1度だけ登録する（--hot のトップレベル再実行で多重登録しない）。
function registerRelease(): void {
  const g = globalThis as { __worldLockReleaseRegistered?: boolean };
  if (g.__worldLockReleaseRegistered) return;
  g.__worldLockReleaseRegistered = true;
  process.on("exit", releaseWorldLock);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      releaseWorldLock();
      process.exit(0);
    });
  }
}
