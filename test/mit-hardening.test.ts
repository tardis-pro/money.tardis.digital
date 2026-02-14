import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readJsonFile, writeJsonFile } from "../src/utils.js";
import { MITScreeniPyService } from "../src/services/mit/screenipy-mit-connector.js";

test("writeJsonFile creates backup and writes durable JSON", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mit-hardening-"));
  try {
    const filePath = path.join(tmpDir, "state.json");
    await writeJsonFile(filePath, { version: 1, value: "before" });
    await writeJsonFile(filePath, { version: 2, value: "after" });

    const current = JSON.parse(await readFile(filePath, "utf8")) as { version: number; value: string };
    const backup = JSON.parse(await readFile(`${filePath}.bak`, "utf8")) as { version: number; value: string };

    assert.equal(current.version, 2);
    assert.equal(current.value, "after");
    assert.equal(backup.version, 1);
    assert.equal(backup.value, "before");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("readJsonFile throws on malformed JSON for existing file", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mit-hardening-"));
  try {
    const filePath = path.join(tmpDir, "broken.json");
    await writeFile(filePath, "{ not-valid-json", "utf8");

    let threw = false;
    try {
      await readJsonFile(filePath, { ok: false });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("MITScreeniPyService opens circuit after repeated failures", async () => {
  const service = new MITScreeniPyService() as unknown as {
    runScan: (config?: unknown) => Promise<unknown>;
    screeniPyService: { run: () => Promise<never> };
  };

  let calls = 0;
  service.screeniPyService = {
    run: async () => {
      calls += 1;
      throw new Error("upstream failed");
    },
  };

  await assert.rejects(() => service.runScan());
  await assert.rejects(() => service.runScan());
  await assert.rejects(() => service.runScan());
  await assert.rejects(() => service.runScan(), /circuit open/i);
  assert.equal(calls, 3);
});
