import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../../server/logs.mjs";
test("logs rotate, retain bounded query history, export and recover after restart", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "sceneloom-logs-"));
  try {
    const logger = await createLogger(folder, {
      maxBytes: 350,
      keep: 2,
      capacity: 4,
    });
    for (let i = 0; i < 8; i++)
      logger.write(i === 7 ? "error" : "info", "task", `message-${i}`, {
        jobId: "sample",
      });
    await logger.flush();
    assert.equal(logger.query().entries.length, 4);
    assert.equal(
      logger.query({ level: "error" }).entries[0].message,
      "message-7",
    );
    assert.equal(logger.query({ after: 7 }).entries.length, 1);
    assert.equal(logger.query({ search: "sample" }).entries.length, 4);
    assert.ok((await readdir(folder)).length <= 3);
    assert.match(await logger.export(), /message-7/);
    await appendFile(
      path.join(folder, "application.jsonl"),
      "invalid truncated line",
    );
    const restored = await createLogger(folder, {
      maxBytes: 350,
      keep: 2,
      capacity: 4,
    });
    assert.equal(restored.query().cursor, 8);
    assert.equal(restored.write("info", "application", "restart").id, 9);
    await restored.flush();
    const recoveredAgain = await createLogger(folder, {
      maxBytes: 350,
      keep: 2,
      capacity: 4,
    });
    assert.equal(recoveredAgain.query().cursor, 9);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
