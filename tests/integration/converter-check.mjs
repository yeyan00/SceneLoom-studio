import path from "node:path";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.mjs";
import { createLasFixture } from "../fixtures/generate.mjs";
const service = await startTestServer({ checkBuild: false });
try {
  const output = await createLasFixture(path.join(service.home, "中文 数据", "测试点云.las"));
  const api = service.api;
  const info = await api("/open", { path: output });
  assert.equal(info.kind, "convert");
  const started = await api("/convert", { source: output });
  let job;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    job = await api(`/jobs/${started.id}`);
    if (!["running", "cancelling"].includes(job.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(job.status, "succeeded", job.error || job.log);
  assert.equal(job.dataset.metadata.points, 50000);
  assert.equal(path.dirname(job.dataset.projectPath),path.dirname(job.dataset.folder));
  assert.equal(path.basename(job.dataset.folder),'pointcloud');
  const entry=JSON.parse(await (await import('node:fs/promises')).readFile(job.dataset.projectPath,'utf8'));
  assert.equal(entry.database,'project.db');assert.equal(entry.dataset.source,'pointcloud');assert.ok(entry.originalSource.path.endsWith('测试点云.las'));
  const reopened = await api("/open", { path: output });
  assert.equal(reopened.reused, true);
  assert.equal(reopened.dataset.id, job.dataset.id);
  console.log(
    JSON.stringify({
      passed: true,
      points: job.dataset.metadata.points,
      reused: reopened.reused,
      fixture: output,
      output: job.dataset.folder,
    }),
  );
} finally {
  await service.close();
}
