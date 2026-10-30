import {
  treeColor,
  pointTreeValue,
  TREE_FIELD,
} from "../../shared/forestry.mjs";
import { evaluatePoint, palette, selected } from "../../shared/edits.mjs";
export function decode(buffer, metadata, count) {
  const stride = metadata.attributes.reduce((s, a) => s + a.size, 0);
  if (buffer.byteLength !== stride * count)
    throw new Error(
      `点块字节数不匹配：${buffer.byteLength} / ${stride * count}`,
    );
  const view = new DataView(buffer),
    positions = new Float32Array(count * 3),
    rgb = new Float32Array(count * 3),
    categories = new Uint8Array(count);
  let treeIds;
  let offset = 0;
  for (const a of metadata.attributes) {
    for (let i = 0; i < count; i++) {
      const p = i * stride + offset;
      if (a.name === "position")
        for (let k = 0; k < 3; k++)
          positions[i * 3 + k] =
            view.getInt32(p + k * 4, true) * metadata.scale[k];
      else if (["rgb", "rgba"].includes(a.name))
        for (let k = 0; k < 3; k++) {
          const v =
            a.elementSize === 2
              ? view.getUint16(p + k * 2, true)
              : view.getUint8(p + k);
          rgb[i * 3 + k] = (v > 255 ? v / 256 : v) / 255;
        }
      else if (a.name === "classification") categories[i] = view.getUint8(p);
    }
    if (
      a.name === "treeID" &&
      ["uint16", "uint32"].includes(a.type) &&
      a.numElements === 1
    ) {
      treeIds =
        a.type === "uint16" ? new Uint16Array(count) : new Uint32Array(count);
      for (let i = 0; i < count; i++)
        treeIds[i] =
          a.type === "uint16"
            ? view.getUint16(i * stride + offset, true)
            : view.getUint32(i * stride + offset, true);
    }
    offset += a.size;
  }
  if (!metadata.attributes.some((a) => ["rgb", "rgba"].includes(a.name)))
    rgb.fill(0.7);
  return { positions, rgb, categories, ...(treeIds ? { treeIds } : {}) };
}
export function edit(
  positions,
  categories,
  operations,
  preview = null,
  base = null,
  classColors = null,
  forest = {},
) {
  const colors = new Float32Array(positions.length),
    indices = [],
    highlights = new Float32Array(categories.length),
    effective = new Uint8Array(categories.length),
    deleted = new Uint8Array(categories.length);
  const lut = palette.map((hex) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
  );
  for (const [id, hex] of Object.entries(classColors || {}))
    lut[Number(id)] = [1, 3, 5].map(
      (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
    );
  const valueType =
    forest.valueType ||
    operations.find(
      (op) => op.type === "createTree" || op.type === "segmentTrees",
    )?.valueType ||
    (base?.treeIds instanceof Uint32Array ? "uint32" : "uint16");
  const TreeArray = valueType === "uint32" ? Uint32Array : Uint16Array;
  const treeIds =
    forest.valueType ||
    base?.treeIds ||
    operations.some(
      (op) => op.type === "createTree" || op.type === "segmentTrees",
    )
      ? new TreeArray(categories.length)
      : null;
  const treeLut = new Map();
  for (let i = 0; i < categories.length; i++) {
    const result = base?.deleted[i]
      ? { category: base.effective[i], deleted: true }
      : base &&
          operations.length === 1 &&
          operations[0].type === "classify" &&
          base.effective[i] === operations[0].category
        ? { category: base.effective[i], deleted: false }
        : evaluatePoint(
            positions[i * 3],
            positions[i * 3 + 1],
            positions[i * 3 + 2],
            base ? base.effective[i] : categories[i],
            operations,
          );
    if (treeIds) {
      let value = base?.treeIds?.[i] ?? forest.sourceTreeIds?.[i] ?? 0,
        removed = !!base?.deleted[i],
        currentCategory = base?.effective[i] ?? categories[i];
      for (const op of operations) {
        if (removed) break;
        if (
          op.type === "delete" &&
          selected(
            positions[i * 3],
            positions[i * 3 + 1],
            positions[i * 3 + 2],
            op,
          )
        )
          removed = true;
        else if (
          op.type === "classify" &&
          selected(
            positions[i * 3],
            positions[i * 3 + 1],
            positions[i * 3 + 2],
            op,
          )
        )
          currentCategory = op.category;
        else
          value = pointTreeValue(
            value,
            op,
            positions[i * 3],
            positions[i * 3 + 1],
            positions[i * 3 + 2],
            selected,
            currentCategory,
          );
      }
      treeIds[i] = value;
    }
    let color = lut[result.category] || [0.7, 0.5, 0.9];
    if (forest.view === "tree") {
      const value = treeIds?.[i] || 0;
      if (!treeLut.has(value)) {
        const hex = treeColor(value);
        const dim = forest.activeTree && value !== forest.activeTree ? 0.5 : 1;
        treeLut.set(
          value,
          [1, 3, 5].map((k) => (parseInt(hex.slice(k, k + 2), 16) / 255) * dim),
        );
      }
      color = treeLut.get(value);
    }
    colors.set(color, i * 3);
    effective[i] = result.category;
    deleted[i] = Number(result.deleted);
    if (
      preview &&
      !result.deleted &&
      selected(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
        preview,
      )
    )
      highlights[i] = 1;
    if (!result.deleted) indices.push(i);
  }
  return {
    colors,
    indices: new Uint32Array(indices),
    highlights,
    effective,
    ...(treeIds ? { treeIds } : {}),
    deleted,
  };
}
const stateOf = (result) => ({
  effective: result.effective,
  deleted: result.deleted,
  ...(result.treeIds ? { treeIds: result.treeIds } : {}),
});
const cache = new Map();
const commandDefinitions = new Map();
export function brushPreview(
  node,
  base,
  brush,
  historyKey,
  classColors,
  forest = {},
) {
  const previous = node.brush;
  const colorKey = JSON.stringify([
    classColors || {},
    forest.view,
    forest.activeTree,
  ]);
  const compatible =
    previous?.id === brush.id &&
    previous.colorKey === colorKey &&
    previous.historyKey === historyKey &&
    previous.samples.length <= brush.selection.samples.length &&
    previous.samples.every((p, i) =>
      p.every((v, k) => v === brush.selection.samples[i][k]),
    );
  const start = compatible ? Math.max(0, previous.samples.length - 1) : 0;
  const delta = {
    ...brush,
    selection: {
      ...brush.selection,
      samples: brush.selection.samples.slice(start),
    },
  };
  let live = compatible ? previous : null;
  if (!live) {
    const initial = edit(
        node.positions,
        node.categories,
        [],
        null,
        base,
        classColors,
        forest,
      ),
      projectionKey = JSON.stringify([
        brush.selection.matrix,
        brush.selection.viewport,
      ]),
      reusable = node.projection?.key === projectionKey,
      buckets = reusable ? node.projection.buckets : new Map();
    const m = brush.selection.matrix,
      [width, height] = brush.selection.viewport;
    for (let i = 0; !reusable && i < node.categories.length; i++) {
      const x = node.positions[i * 3],
        y = node.positions[i * 3 + 1],
        z = node.positions[i * 3 + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0) continue;
      const depth = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      if (depth < -1 || depth > 1) continue;
      const px =
          (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * width) / 2,
        py = ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * height) / 2;
      const key = Math.floor(px / 64) + "," + Math.floor(py / 64),
        items = buckets.get(key) || [];
      items.push(i);
      buckets.set(key, items);
    }
    node.projection = { key: projectionKey, buckets };
    live = {
      state: stateOf(initial),
      colors: initial.colors,
      indices: initial.indices,
      buckets,
    };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y, r] of delta.selection.samples) {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  const isTree = brush.type === "setAttribute";
  const hex = isTree
    ? treeColor(brush.value)
    : classColors?.[brush.category] || palette[brush.category];
  const color = hex
    ? [1, 3, 5].map(
        (i) =>
          (parseInt(hex.slice(i, i + 2), 16) / 255) *
          (isTree && forest.activeTree && brush.value !== forest.activeTree
            ? 0.5
            : 1),
      )
    : [0.7, 0.5, 0.9];
  for (let bx = Math.floor(minX / 64); bx <= Math.floor(maxX / 64); bx++)
    for (let by = Math.floor(minY / 64); by <= Math.floor(maxY / 64); by++) {
      const items = live.buckets.get(bx + "," + by);
      if (!items) continue;
      for (const i of items)
        if (
          !live.state.deleted[i] &&
          (isTree
            ? live.state.treeIds[i] !== brush.value
            : live.state.effective[i] !== brush.category) &&
          selected(
            node.positions[i * 3],
            node.positions[i * 3 + 1],
            node.positions[i * 3 + 2],
            delta,
          )
        ) {
          if (isTree) {
            const before = live.state.treeIds[i],
              after = pointTreeValue(
                before,
                brush,
                node.positions[i * 3],
                node.positions[i * 3 + 1],
                node.positions[i * 3 + 2],
                () => true,
              );
            live.state.treeIds[i] = after;
            if (after !== before && forest.view === "tree")
              live.colors.set(color, i * 3);
          } else {
            live.state.effective[i] = brush.category;
            if (forest.view !== "tree") live.colors.set(color, i * 3);
          }
        }
    }
  const result = {
    ...live.state,
    colors: live.colors.slice(),
    indices: live.indices.slice(),
    highlights: new Float32Array(node.categories.length),
  };
  node.brush = {
    ...live,
    colorKey,
    id: brush.id,
    historyKey,
    samples: brush.selection.samples,
    state: live.state,
    operation: JSON.stringify(brush),
  };
  return result;
}
if (typeof self !== "undefined")
  self.onmessage = ({ data }) => {
    try {
      let result;
      if (data.type === "resetOperations") {
        commandDefinitions.clear();
        result = {};
      } else if (data.type === "forget") {
        cache.delete(data.key);
        result = {};
      } else if (data.type === "decode") {
        result = decode(data.buffer, data.metadata, data.count);
        cache.set(data.key, {
          positions: result.positions.slice(),
          categories: result.categories.slice(),
          sourceTreeIds: result.treeIds?.slice(),
          checkpoints: [],
        });
      } else if (data.type === "update") {
        for (const op of data.commandDefinitions || [])
          commandDefinitions.set(op.id, op);
        data.operations = data.operations.map((op) => {
          if (op.type !== "segmentTreesRef") return op;
          const definition = commandDefinitions.get(op.id);
          if (!definition) throw new Error("CHM 命令缓存已释放");
          return definition;
        });
        const node = cache.get(data.key);
        if (!node) throw new Error("节点已释放");
        const signatures = data.operations.map(
          (op) => op.id || JSON.stringify(op),
        );
        // Promote an exact completed live stroke rather than evaluating it again on mouse-up.
        if (
          node.brush &&
          data.operations.length &&
          data.operations.at(-1).id === node.brush.id &&
          node.brush.operation === JSON.stringify(data.operations.at(-1)) &&
          node.brush.historyKey === JSON.stringify(signatures.slice(0, -1))
        ) {
          node.checkpoints.push({
            key: JSON.stringify(signatures),
            signatures,
            state: node.brush.state,
          });
        }
        const checkpoint = node.checkpoints
          .filter(
            (item) =>
              item.signatures.length <= signatures.length &&
              item.signatures.every((id, i) => id === signatures[i]),
          )
          .sort((a, b) => b.signatures.length - a.signatures.length)[0];
        result =
          data.brush && checkpoint?.signatures.length === signatures.length
            ? checkpoint.state
            : edit(
                node.positions,
                node.categories,
                checkpoint
                  ? data.operations.slice(checkpoint.signatures.length)
                  : data.operations,
                data.preview,
                checkpoint?.state,
                data.classColors,
                { ...data.forest, sourceTreeIds: node.sourceTreeIds },
              );
        const key = JSON.stringify(signatures);
        node.checkpoints = node.checkpoints.filter((item) => item.key !== key);
        node.checkpoints.push({
          key,
          signatures,
          state: stateOf(result),
        });
        if (node.checkpoints.length > 8) node.checkpoints.shift();
        if (data.brush)
          result = brushPreview(
            node,
            stateOf(result),
            data.brush,
            key,
            data.classColors,
            { ...data.forest, sourceTreeIds: node.sourceTreeIds },
          );
        else node.brush = null;
        delete result.effective;
        delete result.deleted;
        delete result.treeIds;
      } else
        result = edit(
          data.positions,
          data.categories,
          data.operations,
          data.preview,
        );
      self.postMessage(
        { id: data.id, result },
        Object.values(result).map((v) => v.buffer),
      );
    } catch (e) {
      self.postMessage({ id: data.id, error: e.message });
    }
  };
