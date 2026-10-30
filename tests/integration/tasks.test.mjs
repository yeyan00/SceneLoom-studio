import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";

test("task list retains concurrent successes, failures and cancelled jobs with logs and timestamps", async () => {
  const service = await startTestServer({
    checkBuild: false,
    tools: async (directory) => {
      for (const [id, code] of [
        ["slow", "console.log('running'); setTimeout(()=>{},20000)"],
        ["success", "console.log('success-output')"],
        ["fail", "console.error('detailed failure');process.exit(123)"],
      ]) {
        await writeFile(
          path.join(directory, `${id}.json`),
          JSON.stringify({
            id: `test.${id}`,
            title: id,
            category: ["Tests"],
            executable: process.execPath,
            args: ["-e", code],
            parameters: [],
          }),
        );
      }
    },
  });
  try {
    const jobs = await Promise.all(
      ["slow", "success", "fail"].map((id) =>
        service.api(`/tools/test.${id}/run`, {}),
      ),
    );
    assert.equal(new Set(jobs.map((job) => job.id)).size, 3);
    await service.api(`/jobs/${jobs[0].id}/cancel`, {});
    let listed;
    for (let i = 0; i < 100; i++) {
      listed = (await service.api("/jobs")).jobs;
      if (listed.length === 3 && listed.every((job) => job.finishedAt)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(listed.length, 3);
    assert.deepEqual(
      new Set(listed.map((job) => job.status)),
      new Set(["succeeded", "failed", "cancelled"]),
    );
    assert.ok(listed.every((job) => job.finishedAt >= job.startedAt));
    const failure = listed.find((job) => job.status === "failed");
    assert.equal(failure.exitCode, 123);
    assert.match(failure.log, /detailed failure/);
    assert.match(failure.error, /123/);
    assert.equal(
      listed.find((job) => job.status === "succeeded").log.trim(),
      "success-output",
    );
  } finally {
    await service.close();
  }
});
