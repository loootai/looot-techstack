import fs from "node:fs";
import path from "node:path";

const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` while holding `<file>.lock`, a file created with the exclusive flag, so two requests or two processes on the same
 * disk never run it at once. A lock older than 15 seconds belongs to a dead process and is cleared. Waits up to 30 seconds.
 */
export async function withFileLock<T>(file: string, fn: () => T | Promise<T>): Promise<T> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error(`${path.basename(file)} is locked by another process. Try again.`);
      await sleep(5 + Math.floor(Math.random() * 15));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Writes JSON through a temp file and a rename, so a reader never sees half a file. */
export function writeFileAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
