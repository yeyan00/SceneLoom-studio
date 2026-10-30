import { createAccumulator, finishChm, parameters } from "./algorithm.mjs";
import { MAX_CHM_CELLS } from "../../shared/chm.mjs";

export function planChmTiles(bounds, input) {
  const p = parameters(input),
    r = p.resolution;
  const width = Math.max(1, Math.ceil((bounds.max[0] - bounds.min[0]) / r) + 1);
  const height = Math.max(
    1,
    Math.ceil((bounds.max[1] - bounds.min[1]) / r) + 1,
  );
  if (width * height > MAX_CHM_CELLS)
    throw Error("结果栅格过大，请增大 CHM 像元或截取局部区域");
  const core = Math.max(1, Math.floor(p.tileSize / r));
  if (Math.ceil(width / core) * Math.ceil(height / core) > 4096)
    throw Error("处理分块过多，请增大分块尺寸");
  // Terrain morphology has a wider footprint than the canopy smoothing.
  const halo = Math.ceil(
    Math.max(
      p.overlap,
      2 * p.groundWindow + 2 * p.terrainResolution,
      p.seedDistance + 2 * r,
    ) / r,
  );
  const tiles = [];
  for (let y = 0; y < height; y += core)
    for (let x = 0; x < width; x += core) {
      const endX = Math.min(width, x + core),
        endY = Math.min(height, y + core);
      const sx = Math.max(0, x - halo),
        sy = Math.max(0, y - halo),
        ex = Math.min(width, endX + halo),
        ey = Math.min(height, endY + halo);
      if ((ex - sx) * (ey - sy) > MAX_CHM_CELLS)
        throw Error("分块缓冲区过大，请减小分块尺寸或增大 CHM 像元");
      const min = [
        bounds.min[0] + sx * r,
        bounds.min[1] + sy * r,
        bounds.min[2],
      ];
      // A tiny inward tolerance prevents floating-point ceil from adding a cell.
      const max = [
        min[0] + Math.max(0, ex - sx - 1) * r,
        min[1] + Math.max(0, ey - sy - 1) * r,
        bounds.max[2],
      ];
      tiles.push({
        id: tiles.length,
        x,
        y,
        endX,
        endY,
        sx,
        sy,
        ex,
        ey,
        bounds: { min, max },
      });
    }
  return { p, width, height, origin: bounds.min.slice(0, 2), halo, tiles };
}

// Extract tile work arrays from a single streamed raster accumulation. Keep the
// terrain grid phase fixed globally even when CHM/coarse resolutions differ.
export function sliceAccumulator(
  source,
  tile,
  acc = createAccumulator(tile.bounds, source.p),
) {
  const r = source.p.resolution,
    tr = source.p.terrainResolution;
  let points = 0,
    groundPoints = 0;
  for (let y = 0; y < acc.height; y++)
    for (let x = 0; x < acc.width; x++) {
      const src = (y + tile.sy) * source.width + x + tile.sx,
        dst = y * acc.width + x;
      acc.top[dst] = source.top[src];
      points += source.pointCounts[src];
      groundPoints += source.groundCounts[src];
    }
  const sx = Math.floor((tile.sx * r) / tr),
    sy = Math.floor((tile.sy * r) / tr);
  acc.terrainOffset = [tile.sx * r - sx * tr, tile.sy * r - sy * tr];
  acc.tw = Math.min(
    source.tw - sx,
    Math.ceil((acc.width * r + acc.terrainOffset[0]) / tr),
  );
  acc.th = Math.min(
    source.th - sy,
    Math.ceil((acc.height * r + acc.terrainOffset[1]) / tr),
  );
  acc.low = new Float64Array(acc.tw * acc.th);
  acc.ground = new Float64Array(acc.low.length);
  for (let y = 0; y < acc.th; y++)
    for (let x = 0; x < acc.tw; x++) {
      const src = (y + sy) * source.tw + x + sx,
        dst = y * acc.tw + x;
      acc.low[dst] = source.low[src];
      acc.ground[dst] = source.ground[src];
    }
  Object.defineProperty(acc, "stats", {
    get: () => ({ points, groundPoints }),
  });
  return acc;
}

// A union must never collapse two distinct instances observed in the same tile.
class Instances {
  parent = [0];
  members = [new Set()];
  add(tile) {
    const id = this.parent.length;
    this.parent.push(id);
    this.members.push(new Set([tile]));
    return id;
  }
  find(i) {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r];
    while (i !== r) {
      const n = this.parent[i];
      this.parent[i] = r;
      i = n;
    }
    return r;
  }
  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return false;
    for (const tile of this.members[a])
      if (this.members[b].has(tile)) return false;
    if (this.members[a].size < this.members[b].size) [a, b] = [b, a];
    this.parent[b] = a;
    for (const tile of this.members[b]) this.members[a].add(tile);
    this.members[b].clear();
    return true;
  }
}

export function matchOverlap(a, b, resolution, seedDistance) {
  const sx = Math.max(a.tile.sx, b.tile.sx),
    sy = Math.max(a.tile.sy, b.tile.sy),
    ex = Math.min(a.tile.ex, b.tile.ex),
    ey = Math.min(a.tile.ey, b.tile.ey);
  if (sx >= ex || sy >= ey) return [];
  const pairs = new Map(),
    ca = new Map(),
    cb = new Map();
  for (let y = sy; y < ey; y++)
    for (let x = sx; x < ex; x++) {
      const u = a.labels[(y - a.tile.sy) * a.width + x - a.tile.sx],
        v = b.labels[(y - b.tile.sy) * b.width + x - b.tile.sx];
      if (u) ca.set(u, (ca.get(u) || 0) + 1);
      if (v) cb.set(v, (cb.get(v) || 0) + 1);
      if (u && v) {
        const key = u + ":" + v;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    }
  const bestA = new Map(),
    bestB = new Map(),
    candidates = [];
  for (const [key, n] of pairs) {
    const [u, v] = key.split(":").map(Number),
      pa = a.peaks.get(u),
      pb = b.peaks.get(v);
    const score = (2 * n) / (ca.get(u) + cb.get(v));
    if (
      n < 4 ||
      score < 0.6 ||
      !pa ||
      !pb ||
      Math.hypot(pa.x - pb.x, pa.y - pb.y) >
        Math.max(2 * resolution, seedDistance * 0.5)
    )
      continue;
    const pair = { u, v, n, score };
    candidates.push(pair);
    if (!bestA.has(u) || score > bestA.get(u).score) bestA.set(u, pair);
    if (!bestB.has(v) || score > bestB.get(v).score) bestB.set(v, pair);
  }
  return candidates
    .filter((p) => bestA.get(p.u) === p && bestB.get(p.v) === p)
    .map((p) => [a.ids[p.u], b.ids[p.v]]);
}

// load(tile,accumulator) fills a tile or returns its pre-accumulated raster slice.
// Only one tile's watershed scratch arrays plus a bounded neighbor window live.
export async function segmentTiled(bounds, input, load, progress = () => {}) {
  const plan = planChmTiles(bounds, input),
    { p, width, height, origin } = plan;
  const labels = new Uint32Array(width * height),
    ground = new Float64Array(width * height).fill(NaN),
    heights = new Float32Array(width * height).fill(NaN);
  const instances = new Instances(),
    active = [],
    warnings = new Set(),
    methods = new Set();
  let merges = 0,
    scannedPoints = 0,
    nodes = 0,
    points = 0,
    groundPoints = 0,
    seedCount = 0,
    maxTileCells = 0,
    maxNeighborCells = 0,
    peakRss = process.memoryUsage().rss;
  for (const tile of plan.tiles) {
    progress({
      phase: "segment",
      tilesDone: tile.id,
      totalTiles: plan.tiles.length,
      scannedPoints,
    });
    // Future tiles start at >= tile.sy. Expired rows cannot overlap again.
    if (tile.x === 0)
      for (let i = active.length - 1; i >= 0; i--)
        if (active[i].tile.ey <= tile.sy) active.splice(i, 1);
    let acc = createAccumulator(tile.bounds, p);
    const scan = await load(tile, acc);
    if (scan?.accumulator) acc = scan.accumulator;
    scannedPoints += scan?.scannedPoints || 0;
    nodes += scan?.nodes || 0;
    maxTileCells = Math.max(maxTileCells, acc.width * acc.height);
    if (acc.width !== tile.ex - tile.sx || acc.height !== tile.ey - tile.sy)
      throw Error("CHM 分块网格未对齐");
    if (acc.stats.points) {
      const result = finishChm(acc),
        ids = [0];
      for (let i = 0; i < result.treeCount; i++)
        ids.push(instances.add(tile.id));
      const current = {
        tile,
        width: result.grid.width,
        labels: Uint32Array.from(result.grid.labels),
        peaks: new Map(result.peaks.map((v) => [v.id, v])),
        ids,
      };
      for (const neighbor of active)
        for (const [a, b] of matchOverlap(
          neighbor,
          current,
          p.resolution,
          p.seedDistance,
        ))
          if (instances.union(a, b)) merges++;
      for (let y = tile.y; y < tile.endY; y++)
        for (let x = tile.x; x < tile.endX; x++) {
          const src = (y - tile.sy) * current.width + x - tile.sx,
            dst = y * width + x;
          labels[dst] = ids[current.labels[src]];
          ground[dst] = result.grid.ground[src];
          heights[dst] = result.preview.heights[src] ?? NaN;
        }
      points += acc.stats.points;
      groundPoints += acc.stats.groundPoints;
      seedCount += result.stats.seedCount;
      methods.add(result.stats.groundMethod);
      result.warnings.forEach((w) => warnings.add(w));
      active.push(current);
    }
    maxNeighborCells = Math.max(
      maxNeighborCells,
      active.reduce((n, v) => n + v.labels.length, 0),
    );
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    progress({
      phase: "segment",
      tilesDone: tile.id + 1,
      totalTiles: plan.tiles.length,
      scannedPoints,
      peakRssBytes: peakRss,
    });
  }
  if (!points) throw Error("计算范围内没有有效点");
  const areas = new Map();
  for (const id of labels)
    if (id) {
      const root = instances.find(id);
      areas.set(root, (areas.get(root) || 0) + 1);
    }
  const remap = new Map();
  for (let i = 0; i < labels.length; i++)
    if (labels[i]) {
      const root = instances.find(labels[i]);
      if (areas.get(root) * p.resolution ** 2 < p.minCrownArea) {
        labels[i] = 0;
        continue;
      }
      if (!remap.has(root)) remap.set(root, remap.size + 1);
      labels[i] = remap.get(root);
    }
  // points and support include halos: report explicitly, never as unique counts.
  return {
    grid: {
      origin,
      resolution: p.resolution,
      width,
      height,
      ground: Array.from(ground, (v) => (Number.isFinite(v) ? v : null)),
      labels: Array.from(labels),
    },
    preview: {
      heights: Array.from(heights, (v) => (Number.isFinite(v) ? v : null)),
    },
    treeCount: remap.size,
    parameters: p,
    warnings: [...warnings],
    stats: {
      cells: width * height,
      tileCount: plan.tiles.length,
      haloMeters: plan.halo * p.resolution,
      mergedInstances: merges,
      seedCount,
      groundMethod: methods.size === 1 ? [...methods][0] : "mixed",
      scannedPoints,
      nodes,
      pointsWithOverlap: points,
      groundPointsWithOverlap: groundPoints,
      maxTileCells,
      maxNeighborCells,
      peakRssBytes: peakRss,
      resultArrayBytes:
        labels.byteLength + ground.byteLength + heights.byteLength,
    },
  };
}
