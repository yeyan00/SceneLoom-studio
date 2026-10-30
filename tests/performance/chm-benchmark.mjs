import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startTestServer, projectRoot } from "../helpers/server.mjs";
const source = process.env.SCENELOOM_CHM_POTREE;
if (!source)
  throw new Error(
    "Set SCENELOOM_CHM_POTREE to a Potree directory. Optional SCENELOOM_CHM_REGION and SCENELOOM_CHM_PARAMETERS are JSON.",
  );
const scope = process.env.SCENELOOM_CHM_REGION
  ? JSON.parse(process.env.SCENELOOM_CHM_REGION)
  : null;
const parameters = JSON.parse(process.env.SCENELOOM_CHM_PARAMETERS || "{}");
const service = await startTestServer();
try {
  const { dataset } = await service.api("/open", { path: source });
  const start = performance.now(),
    latencies = [];
  const job = await service.api(`/datasets/${dataset.id}/chm`, {
    operations: [],
    scope,
    parameters,
    policy: "unassigned",
    valueType: "uint16",
  });
  let result;
  for (let i = 0; i < 3600; i++) {
    const at = performance.now();
    await service.api("/settings");
    latencies.push(performance.now() - at);
    result = await service.api(`/datasets/${dataset.id}/chm/${job.id}`);
    if (result.status !== "running") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (result.status !== "succeeded")
    throw new Error(result.error || result.status);
  const wallMs = performance.now() - start;
  latencies.sort((a, b) => a - b);
  const output = {
    sourcePoints: dataset.metadata.points,
    scope,
    parameters,
    wallMs,
    ...result.summary,
    apiLatency: {
      samples: latencies.length,
      p95Ms:
        latencies[
          Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
        ],
      maxMs: latencies.at(-1),
    },
    note: "Timing and output size only; tree accuracy requires annotated reference data. Source is not modified.",
  };
  const directory = path.join(
    projectRoot,
    "test-results",
    new Date().toISOString().replace(/[:.]/g, "-") + "-chm",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "chm-performance.json"),
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify({ ...output, report: directory }, null, 2));
} finally {
  await service.close();
}
