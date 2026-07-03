import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), ".digest-cache");

export function cacheDir(weekStart: string): string {
  return path.join(ROOT, weekStart);
}

export function readCached<T = unknown>(weekStart: string, key: string): T | null {
  const file = path.join(cacheDir(weekStart), `${key}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

export function writeCached(weekStart: string, key: string, data: unknown): void {
  const dir = cacheDir(weekStart);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(data, null, 2));
}
