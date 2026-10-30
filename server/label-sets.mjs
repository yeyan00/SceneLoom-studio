import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  lasLabelSet,
  LAS_LABEL_SET_ID,
  validateLabelSet,
} from "../shared/label-sets.mjs";
export function createLabelLibrary(directory) {
  const file = path.join(directory, "label-sets.json");
  let queue = Promise.resolve();
  async function read() {
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      if (!Array.isArray(data)) throw new Error("标签库格式无效");
      data.forEach(validateLabelSet);
      return data;
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  return {
    async list() {
      await queue.catch(() => {});
      return { labelSets: [lasLabelSet(), ...(await read())] };
    },
    update(input) {
      const run = queue
        .catch(() => {})
        .then(async () => {
          const sets = await read(),
            id = input.action === "delete" ? input.id : input.labelSet?.id;
          if (id === LAS_LABEL_SET_ID)
            throw new Error("内置标签集只读，请先复制");
          const index = sets.findIndex((s) => s.id === id),
            version = index < 0 ? 0 : sets[index].version;
          if (input.expectedVersion !== version)
            throw new Error("标签库版本已改变，请重新打开管理器");
          let labelSet;
          if (input.action === "delete") {
            if (index < 0) throw new Error("标签集不存在");
            sets.splice(index, 1);
          } else if (input.action === "save") {
            labelSet = structuredClone(input.labelSet);
            labelSet.version = version + 1;
            validateLabelSet(labelSet);
            if (index < 0) {
              if (sets.length >= 128)
                throw new Error("标签库最多保存128套标签集");
              sets.push(labelSet);
            } else sets[index] = labelSet;
          } else throw new Error("无效的标签库操作");
          await mkdir(directory, { recursive: true });
          const tmp = file + "." + randomUUID() + ".tmp";
          await writeFile(tmp, JSON.stringify(sets, null, 2));
          await rename(tmp, file);
          return { labelSet, labelSets: [lasLabelSet(), ...sets] };
        });
      queue = run;
      return run;
    },
  };
}
