import { MAX_CHM_CELLS } from "../../shared/chm.mjs";
import { chmSemantics, lasLabelSet } from "../../shared/label-sets.mjs";

export function parameters(input = {}) {
  const p = {
    resolution: 0.5,
    terrainResolution: 2,
    minHeight: 2,
    seedDistance: 3,
    minCrownArea: 1,
    groundMode: "auto",
    groundWindow: 8,
    tileSize: 64,
    overlap: 12,
    ...chmSemantics(lasLabelSet()),
    ...input,
  };
  for (const [key, lo, hi] of [
    ["resolution", 0.1, 10],
    ["terrainResolution", 0.5, 20],
    ["minHeight", 0.5, 20],
    ["seedDistance", 1, 30],
    ["minCrownArea", 0.1, 100],
    ["groundWindow", 2, 40],
    ["tileSize", 8, 256],
    ["overlap", 2, 80],
  ])
    if (!Number.isFinite(p[key]) || p[key] < lo || p[key] > hi)
      throw new Error("无效的 CHM 参数：" + key);
  if (!["auto", "classified", "estimate"].includes(p.groundMode))
    throw new Error("无效的地面模式");
  for (const key of ["groundIds", "ignoreIds", "excludeCategories"])
    if (
      !Array.isArray(p[key]) ||
      p[key].length > 256 ||
      !p[key].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    )
      throw new Error("无效的分类语义映射");
  return p;
}

// Nearest supported cell, followed by a small smoothing kernel. No invented
// zero elevation in holes. Distances are retained for quality diagnostics.
function fill(values, w, h) {
  const a = Float64Array.from(values),
    distance = new Int32Array(a.length).fill(-1);
  const queue = new Int32Array(a.length);
  let head = 0,
    tail = 0;
  for (let i = 0; i < a.length; i++)
    if (Number.isFinite(a[i])) {
      queue[tail++] = i;
      distance[i] = 0;
    }
  if (!tail) throw new Error("没有可用地面点，无法生成 CHM");
  while (head < tail) {
    const i = queue[head++],
      x = i % w,
      y = Math.floor(i / w);
    for (const j of [
      x ? i - 1 : -1,
      x + 1 < w ? i + 1 : -1,
      y ? i - w : -1,
      y + 1 < h ? i + w : -1,
    ])
      if (j >= 0 && distance[j] < 0) {
        distance[j] = distance[i] + 1;
        a[j] = a[i];
        queue[tail++] = j;
      }
  }
  return { values: a, distance };
}
function median(a, w, h) {
  const out = new Float64Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h)
            v.push(a[(y + dy) * w + x + dx]);
      v.sort((a, b) => a - b);
      out[y * w + x] = v[Math.floor(v.length / 2)];
    }
  return out;
}
// Separable sliding morphology, linear in raster size even for large windows.
function morph(a, w, h, radius, minimum) {
  let src = a;
  for (const vertical of [false, true]) {
    const dst = new Float64Array(a.length),
      length = vertical ? h : w,
      lines = vertical ? w : h;
    for (let line = 0; line < lines; line++) {
      const q = new Int32Array(length);
      let first = 0,
        last = 0,
        next = 0;
      const at = (k) => (vertical ? k * w + line : line * w + k);
      for (let k = 0; k < length; k++) {
        while (next < length && next <= k + radius) {
          while (
            last > first &&
            (minimum
              ? src[at(q[last - 1])] >= src[at(next)]
              : src[at(q[last - 1])] <= src[at(next)])
          )
            last--;
          q[last++] = next++;
        }
        while (q[first] < k - radius) first++;
        dst[at(k)] = src[at(q[first])];
      }
    }
    src = dst;
  }
  return src;
}
export function createAccumulator(bounds, input) {
  const p = parameters(input),
    origin = bounds.min.slice(0, 2);
  const width = Math.max(
    1,
    Math.ceil((bounds.max[0] - origin[0]) / p.resolution - 1e-9) + 1,
  );
  const height = Math.max(
    1,
    Math.ceil((bounds.max[1] - origin[1]) / p.resolution - 1e-9) + 1,
  );
  if (width * height > MAX_CHM_CELLS)
    throw new Error("计算范围过大，请增大 CHM 像元或截取局部区域");
  const tw = Math.max(
    1,
    Math.ceil((width * p.resolution) / p.terrainResolution),
  );
  const th = Math.max(
    1,
    Math.ceil((height * p.resolution) / p.terrainResolution),
  );
  if (tw * th > MAX_CHM_CELLS)
    throw new Error("地面网格过密，请增大地面网格或截取局部区域");
  const top = new Float64Array(width * height).fill(-Infinity);
  const pointCounts = new Uint32Array(width * height),
    groundCounts = new Uint32Array(width * height);
  const low = new Float64Array(tw * th).fill(Infinity),
    ground = new Float64Array(tw * th).fill(Infinity);
  let points = 0,
    groundPoints = 0;
  return {
    p,
    origin,
    width,
    height,
    tw,
    th,
    top,
    pointCounts,
    groundCounts,
    low,
    ground,
    get stats() {
      return { points, groundPoints };
    },
    add(x, y, z, category) {
      if (![x, y, z].every(Number.isFinite) || p.ignoreIds.includes(category))
        return;
      const col = Math.floor((x - origin[0]) / p.resolution),
        row = Math.floor((y - origin[1]) / p.resolution);
      if (col < 0 || row < 0 || col >= width || row >= height) return;
      const i = row * width + col,
        j =
          Math.min(th - 1, Math.floor((y - origin[1]) / p.terrainResolution)) *
            tw +
          Math.min(tw - 1, Math.floor((x - origin[0]) / p.terrainResolution));
      top[i] = Math.max(top[i], z);
      low[j] = Math.min(low[j], z);
      points++;
      pointCounts[i]++;
      if (p.groundIds.includes(category)) {
        ground[j] = Math.min(ground[j], z);
        groundPoints++;
        groundCounts[i]++;
      }
    },
  };
}

class MaxHeap {
  a = [];
  push(item) {
    const a = this.a;
    let i = a.length;
    a.push(item);
    while (i) {
      const p = (i - 1) >> 1;
      if (a[p][0] >= item[0]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.a,
      result = a[0],
      end = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1][0] > a[c][0]) c++;
        if (a[c][0] <= end[0]) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = end;
    }
    return result;
  }
}
export function finishChm(acc) {
  const { p, origin, width: w, height: h, tw, th, top } = acc;
  if (!acc.stats.points) throw new Error("计算范围内没有有效点");
  const support = Array.from(acc.ground).filter(Number.isFinite).length;
  const classified =
    p.groundMode === "classified" || (p.groundMode === "auto" && support >= 3);
  if (classified && !support)
    throw new Error("未找到地面分类点，请使用自动估计");
  let terrain, distance;
  if (classified) ({ values: terrain, distance } = fill(acc.ground, tw, th));
  else {
    let current = median(fill(acc.low, tw, th).values, tw, th);
    const candidates = Float64Array.from(acc.low);
    const maxRadius = Math.max(
      1,
      Math.ceil(p.groundWindow / p.terrainResolution),
    );
    for (let r = 1; ; r = Math.min(r * 2, maxRadius)) {
      const opened = morph(morph(current, tw, th, r, true), tw, th, r, false);
      const threshold = Math.min(2, 0.35 + 0.15 * r * p.terrainResolution);
      for (let i = 0; i < candidates.length; i++)
        if (candidates[i] - opened[i] > threshold) candidates[i] = Infinity;
      current = opened;
      if (r === maxRadius) break;
    }
    ({ values: terrain, distance } = fill(candidates, tw, th));
  }
  terrain = median(terrain, tw, th);
  const ground = new Array(w * h),
    raw = new Float64Array(w * h).fill(NaN),
    valid = new Uint8Array(w * h);
  // Bilinear terrain interpolation at CHM cell centres; never alter source XYZ.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const tx = Math.max(
        0,
        Math.min(
          tw - 1,
          ((x + 0.5) * p.resolution + (acc.terrainOffset?.[0] || 0)) /
            p.terrainResolution -
            0.5,
        ),
      );
      const ty = Math.max(
        0,
        Math.min(
          th - 1,
          ((y + 0.5) * p.resolution + (acc.terrainOffset?.[1] || 0)) /
            p.terrainResolution -
            0.5,
        ),
      );
      const x0 = Math.floor(tx),
        y0 = Math.floor(ty),
        x1 = Math.min(tw - 1, x0 + 1),
        y1 = Math.min(th - 1, y0 + 1),
        fx = tx - x0,
        fy = ty - y0;
      const z =
        (terrain[y0 * tw + x0] * (1 - fx) + terrain[y0 * tw + x1] * fx) *
          (1 - fy) +
        (terrain[y1 * tw + x0] * (1 - fx) + terrain[y1 * tw + x1] * fx) * fy;
      const i = y * w + x;
      ground[i] = Math.round(z * 1000) / 1000;
      if (Number.isFinite(top[i])) {
        raw[i] = Math.max(0, top[i] - ground[i]);
        valid[i] = raw[i] >= p.minHeight;
      }
    }
  // Small, observed-neighbour smoothing; empty canopy pixels remain barriers.
  const surface = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!valid[i]) continue;
      let total = 0,
        weight = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!valid[j]) continue;
          const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          total += raw[j] * k;
          weight += k;
        }
      surface[i] = total / weight;
    }
  const candidates = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!valid[i]) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (
            valid[j] &&
            (surface[j] > surface[i] || (surface[j] === surface[i] && j < i))
          ) {
            peak = false;
            break;
          }
        }
      if (peak) candidates.push(i);
    }
  candidates.sort((a, b) => surface[b] - surface[a] || a - b);
  const seeds = [],
    buckets = new Map(),
    spacing = p.seedDistance / p.resolution;
  for (const i of candidates) {
    const x = i % w,
      y = Math.floor(i / w),
      bx = Math.floor(x / spacing),
      by = Math.floor(y / spacing);
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const j of buckets.get(`${bx + dx},${by + dy}`) || [])
          if (Math.hypot(x - (j % w), y - Math.floor(j / w)) < spacing) {
            near = true;
            break;
          }
    if (!near) {
      seeds.push(i);
      const key = `${bx},${by}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }
  }
  // Seeded maximum-capacity flooding of the inverted CHM (marker watershed).
  const labels = new Uint32Array(w * h),
    best = new Float64Array(w * h).fill(-Infinity),
    heap = new MaxHeap();
  seeds.forEach((i, k) => {
    labels[i] = k + 1;
    best[i] = surface[i];
    heap.push([best[i], i, k + 1]);
  });
  while (heap.a.length) {
    const [score, i, label] = heap.pop();
    if (score !== best[i] || labels[i] !== label) continue;
    const x = i % w,
      y = Math.floor(i / w);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!valid[j]) continue;
        const next = Math.min(score, surface[j]);
        if (next > best[j]) {
          best[j] = next;
          labels[j] = label;
          heap.push([next, j, label]);
        }
      }
  }
  const areas = new Uint32Array(seeds.length + 1);
  for (const label of labels) areas[label]++;
  const remap = new Uint32Array(areas.length);
  let treeCount = 0;
  for (let i = 1; i < areas.length; i++)
    if (areas[i] * p.resolution ** 2 >= p.minCrownArea) remap[i] = ++treeCount;
  for (let i = 0; i < labels.length; i++) labels[i] = remap[labels[i]];
  const warnings = [];
  if (!classified)
    warnings.push("地面由低包络形态学估计，密林及陡坡请检查结果");
  if (Array.from(distance).some((d) => d * p.terrainResolution > 20))
    warnings.push("部分区域距离地面支持点较远，请检查地形估计");
  return {
    grid: {
      origin,
      resolution: p.resolution,
      width: w,
      height: h,
      ground,
      labels: Array.from(labels),
    },
    treeCount,
    peaks: seeds.flatMap((cell, i) =>
      remap[i + 1]
        ? [
            {
              id: remap[i + 1],
              x: origin[0] + ((cell % w) + 0.5) * p.resolution,
              y: origin[1] + (Math.floor(cell / w) + 0.5) * p.resolution,
            },
          ]
        : [],
    ),
    stats: {
      ...acc.stats,
      groundMethod: classified ? "classified" : "morphological",
      groundSupportCells: support,
      cells: w * h,
      seedCount: seeds.length,
    },
    warnings,
    preview: {
      heights: Array.from(raw, (v) =>
        Number.isFinite(v) ? Math.round(v * 100) / 100 : null,
      ),
    },
    parameters: p,
  };
}
