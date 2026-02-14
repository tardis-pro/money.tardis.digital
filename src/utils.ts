import crypto from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  const backupPath = `${filePath}.bak`;
  try {
    try {
      await copyFile(filePath, backupPath);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    const fileHandle = await open(tempPath, "r");
    try {
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    await rename(tempPath, filePath);

    const dirHandle = await open(path.dirname(filePath), "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
