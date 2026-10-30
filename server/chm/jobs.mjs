import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { validateOperation } from "../../shared/edits.mjs";
import {
  validateForestHistory,
  sourceTreeField,
  treeLimit,
} from "../../shared/forestry.mjs";
import { validateRegion } from "../../shared/selection.mjs";
import { parameters } from "./algorithm.mjs";
import { chmSemantics, labelSetForSession } from "../../shared/label-sets.mjs";

export function createChmJobs(logger) {
  const jobs = new Map();
  const publicJob = (j, detail = false) => ({
    id: j.id,
    status: j.status,
    progress: j.progress,
    error: j.error,
    ...(j.result
      ? {
          summary: {
            treeCount: j.result.treeCount,
            stats: j.result.stats,
            warnings: j.result.warnings,
          },
        }
      : {}),
    ...(detail && j.result
      ? {
          preview: {
            ...j.result.preview,
            grid: j.command?.grid || j.result.grid,
          },
        }
      : {}),
  });
  function prepareCommand(ds, j) {
    if (j.command || !j.result.treeCount) return;
    const first = ds.store.allocateTreeId(j.valueType, j.result.treeCount);
    const trees = Array.from({ length: j.result.treeCount }, (_, i) => ({
      id: first + i,
      name: "CHM " + (first + i),
    }));
    const grid = {
      ...j.result.grid,
      labels: j.result.grid.labels.map((v) => (v ? first + v - 1 : 0)),
    };
    j.command = {
      id: randomUUID(),
      payloadVersion: 2,
      type: "segmentTrees",
      valueType: j.valueType,
      trees,
      grid,
      minHeight: j.result.parameters.minHeight,
      scope: j.scope,
      policy: j.policy,
      excludeCategories: j.result.parameters.excludeCategories,
      algorithm: {
        id: "chm-watershed",
        version: 2,
        parameters: j.result.parameters,
        stats: j.result.stats,
      },
    };
    validateOperation(j.command);
  }
  async function verify(ds) {
    if (
      (await readFile(path.join(ds.folder, "metadata.json"), "utf8")) !==
      ds.metadataText
    )
      throw new Error("源点云发生变化，请重新打开");
    for (const [file, expected] of Object.entries(ds.fileStats)) {
      const s = await stat(path.join(ds.folder, file));
      if (s.size !== expected.size || s.mtimeMs !== expected.mtimeMs)
        throw new Error("源点云发生变化，请重新打开");
    }
  }
  return {
    async start(ds, input) {
      for (const [id, j] of jobs)
        if (j.status !== "running" && Date.now() - j.updated > 1800000)
          jobs.delete(id);
      const completed = [...jobs.values()].filter(
        (j) => j.status !== "running",
      );
      for (const j of completed.slice(0, Math.max(0, completed.length - 7)))
        jobs.delete(j.id);
      if ([...jobs.values()].some((j) => j.status === "running"))
        throw new Error("已有 CHM 任务运行中，请等待或取消");
      const operations = input.operations;
      if (!Array.isArray(operations)) throw new Error("编辑历史无效");
      operations.forEach(validateOperation);
      validateForestHistory(operations, ds.meta);
      const scope = input.scope || null;
      if (scope) validateRegion(scope);
      const mapping = chmSemantics(
        Object.hasOwn(input, "labelSet")
          ? input.labelSet
          : labelSetForSession(ds.session),
      );
      const p = parameters({ ...input.parameters, ...mapping });
      const field = sourceTreeField(ds.meta),
        valueType =
          field?.valueType ||
          operations.find(
            (op) => op.type === "createTree" || op.type === "segmentTrees",
          )?.valueType ||
          input.valueType ||
          "uint16";
      if (
        !treeLimit(valueType) ||
        !["unassigned", "replace"].includes(input.policy)
      )
        throw new Error("无效的单木归属设置");
      await verify(ds);
      if ([...jobs.values()].some((j) => j.status === "running"))
        throw new Error("已有 CHM 任务运行中，请等待或取消");
      const j = {
        id: randomUUID(),
        datasetId: ds.id,
        status: "running",
        updated: Date.now(),
        progress: {
          phase: "scan",
          scannedPoints: 0,
          totalPoints: ds.meta.points,
        },
        scope,
        policy: input.policy,
        valueType,
      };
      jobs.set(j.id, j);
      const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
        workerData: {
          folder: ds.folder,
          metadata: ds.meta,
          operations,
          scope,
          parameters: p,
        },
      });
      j.worker = worker;
      const fail = (error) => {
        if (j.status !== "running") return;
        j.status = "failed";
        j.error = error.message || String(error);
        j.updated = Date.now();
        logger?.write("error", "chm", j.error, { jobId: j.id });
      };
      worker.on("message", async (m) => {
        if (j.status !== "running") return;
        if (m.type === "progress") j.progress = m;
        else if (m.type === "error") fail(m.error);
        else if (m.type === "result") {
          try {
            await verify(ds);
            if (j.status !== "running") return;
            j.result = m.result;
            prepareCommand(ds, j);
            j.status = "succeeded";
            j.updated = Date.now();
            logger?.write("info", "chm", "CHM completed", {
              jobId: j.id,
              ...m.result.stats,
              treeCount: m.result.treeCount,
            });
          } catch (e) {
            fail(e);
          }
        }
      });
      worker.on("error", fail);
      worker.on("exit", (code) => {
        if (code) fail(new Error("CHM 工作线程退出：" + code));
      });
      logger?.write("info", "chm", "CHM started", {
        jobId: j.id,
        datasetId: ds.id,
        parameters: p,
      });
      return publicJob(j);
    },
    async handle(ds, id, action) {
      const j = jobs.get(id);
      if (!j || j.datasetId !== ds.id)
        throw new Error("CHM 任务不存在或已过期");
      if (action === "cancel" && j.status === "running") {
        j.status = "cancelled";
        j.updated = Date.now();
        await j.worker.terminate();
        logger?.write("info", "chm", "CHM cancelled", { jobId: id });
      }
      if (action === "apply") {
        if (j.status !== "succeeded" || !j.result?.treeCount)
          throw new Error("没有可应用的单木结果");
        await verify(ds);
        prepareCommand(ds, j);
        return { command: j.command };
      }
      return publicJob(j, action === "result");
    },
    close() {
      for (const j of jobs.values()) j.worker?.terminate();
    },
  };
}
