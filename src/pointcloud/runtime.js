import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EyeDomeLighting } from "./edl.js";
import { regionBounds } from "../../shared/selection.mjs";

class WorkerPool {
  constructor() {
    this.counter = 0;
    this.pending = new Map();
    this.workers = Array.from({ length: 2 }, () => {
      const w = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      w.commandVersions = new Map();
      w.onmessage = ({ data }) => {
        const task = this.pending.get(data.id);
        if (task) {
          this.pending.delete(data.id);
          data.error
            ? task.reject(new Error(data.error))
            : task.resolve(data.result);
        }
      };
      w.onerror = (e) => {
        for (const task of this.pending.values())
          task.reject(new Error(e.message));
        this.pending.clear();
      };
      return w;
    });
  }
  run(type, data, transfer = []) {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const key = data.key || "";
      const worker = key
        ? [...key].reduce((sum, c) => sum + c.charCodeAt(0), 0) %
          this.workers.length
        : id % this.workers.length;
      const target = this.workers[worker];
      // CHM rasters are immutable and may be megabytes. Send each definition
      // once per worker; brush batches and other nodes then carry only IDs.
      if (type === "update") {
        const commandDefinitions = [];
        const operations = data.operations.map((op) => {
          if (op.type !== "segmentTrees") return op;
          if (target.commandVersions.get(op.id) !== op) {
            commandDefinitions.push(op);
            target.commandVersions.set(op.id, op);
          }
          return { type: "segmentTreesRef", id: op.id };
        });
        data = { ...data, operations, commandDefinitions };
      }
      target.postMessage({ id, type, ...data }, transfer);
    });
  }
  dispose() {
    this.workers.forEach((w) => w.terminate());
    for (const t of this.pending.values()) t.reject(new Error("数据已关闭"));
    this.pending.clear();
  }
  clearCommands() {
    for (const worker of this.workers) {
      worker.commandVersions.clear();
      worker.postMessage({ id: 0, type: "resetOperations" });
    }
  }
}
export class PointCloudRuntime {
  constructor(container, onStats, onError) {
    this.container = container;
    this.onStats = onStats;
    this.onError = onError;
    this.pool = new WorkerPool();
    this.nodes = new Map();
    this.operations = [];
    this.observedCategories = new Set();
    this.preview = null;
    this.views = [];
    this.region = null;
    this.metrics = {
      editMs: 0,
      readBytes: 0,
      evaluatedPoints: 0,
      staleResults: 0,
      frames: 0,
      frameMs: 0,
      interactionMs: 0,
      frameIntervals: [],
    };
    this.epoch = 0;
    this.budget = 600000;
    this.mode = "height";
    this.loading = 0;
    this.disposed = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#18212d");
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.edl = new EyeDomeLighting();
    this.edlEnabled = true;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.uniforms = {
      pointSize: { value: 2 },
      mode: { value: 1 },
      zRange: { value: new THREE.Vector2(0, 1000) },
      regionEnabled: { value: false },
      regionCenter: { value: new THREE.Vector3() },
      regionHalf: { value: new THREE.Vector3() },
      regionAngle: { value: new THREE.Vector2(1, 0) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `attribute vec3 rgb; attribute vec3 classificationColor; attribute float highlight; varying vec3 vColor; varying vec3 vPosition; uniform float pointSize; uniform int mode; uniform vec2 zRange;
        vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
        void main(){ vPosition=position;float h=clamp((position.z-zRange.x)/max(zRange.y-zRange.x,0.001),0.,1.); vec3 elevation=mix(vec3(.17,.43,.63),vec3(.90,.70,.35),h); vColor=toLinear(mode==0?rgb:(mode==1?elevation:classificationColor));if(highlight>.5)vColor=toLinear(vec3(1.,.85,.15)); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=pointSize; }`,
      fragmentShader: `varying vec3 vColor;varying vec3 vPosition;uniform bool regionEnabled;uniform vec3 regionCenter;uniform vec3 regionHalf;uniform vec2 regionAngle; void main(){vec3 d=vPosition-regionCenter;vec3 local=vec3(d.x*regionAngle.x+d.y*regionAngle.y,-d.x*regionAngle.y+d.y*regionAngle.x,d.z);if(regionEnabled&&any(greaterThan(abs(local),regionHalf+vec3(.00001))))discard;if(distance(gl_PointCoord,vec2(.5))>.5)discard; gl_FragColor=vec4(vColor,1.);
        #include <colorspace_fragment>
      }`,
    });
    this.resize = new ResizeObserver(() => {
      const w = container.clientWidth,
        h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.updateViewSizes();
    });
    this.resize.observe(container);
    this.lastSchedule = 0;
    this.animate = (t) => {
      if (this.disposed) return;
      this.renderer.domElement.dataset.renderMode = this.mode;
      this.renderer.domElement.dataset.edl = String(this.edlEnabled);
      const frameStart = performance.now();
      if (this.lastFrameTime !== undefined) {
        this.metrics.frameIntervals.push(t - this.lastFrameTime);
        if (this.metrics.frameIntervals.length > 120)
          this.metrics.frameIntervals.shift();
      }
      this.lastFrameTime = t;
      this.renderViews();
      if (
        this.brush &&
        this.brushFrameEpoch !== this.epoch &&
        [...this.nodes.values()].every(
          (n) => !n.object || n.evaluated === this.epoch,
        )
      ) {
        this.brushFrameEpoch = this.epoch;
        this.brushFrames ??= [];
        this.brushFrames.push({
          strokeId: this.brush.id,
          samples: this.brush.selection.samples.length,
          latencyMs: performance.now() - this.brushInputAt,
          cameraLocked: this.selection([], false, "main").matrix.every(
            (v, i) => Math.abs(v - this.brush.selection.matrix[i]) < 1e-8,
          ),
          cachedPoints: [...this.nodes.values()].reduce(
            (sum, n) => sum + (n.object ? n.count : 0),
            0,
          ),
        });
        if (this.brushFrames.length > 512) this.brushFrames.shift();
        this.renderer.domElement.dataset.brushMetrics = JSON.stringify(
          this.brushFrames,
        );
        if (this.pendingBrush) {
          const pending = this.pendingBrush;
          this.pendingBrush = null;
          this.dispatchBrush(pending);
        }
      }
      if (
        this.presentEpoch !== this.epoch &&
        [...this.nodes.values()].every(
          (n) => !n.object || n.evaluated === this.epoch,
        )
      ) {
        this.presentEpoch = this.epoch;
        this.metrics.interactionMs = this.editRequestedAt
          ? performance.now() - this.editRequestedAt
          : 0;
      }
      this.metrics.frames++;
      this.metrics.frameMs = performance.now() - frameStart;
      if (t - this.lastSchedule > 250) {
        this.lastSchedule = t;
        this.schedule().catch(this.onError);
      }
    };
    this.renderer.setAnimationLoop(this.animate);
  }
  setActive(active) {
    this.active = active;
    this.renderer.setAnimationLoop(
      active && !document.hidden ? this.animate : null,
    );
    this.lastFrameTime = undefined;
    if (active) this.updateViewSizes();
  }
  async range(file, offset, size) {
    if (size === 0n) return new ArrayBuffer(0);
    const r = await fetch(`/api/datasets/${this.dataset.id}/files/${file}`, {
      headers: { Range: `bytes=${offset}-${offset + size - 1n}` },
      signal: this.abort.signal,
    });
    if (r.status !== 206) throw new Error(`范围读取失败 ${r.status}`);
    const buffer = await r.arrayBuffer();
    this.metrics.readBytes += buffer.byteLength;
    return buffer;
  }
  async open(dataset) {
    this.abort?.abort();
    this.abort = new AbortController();
    this.clear();
    this.dataset = dataset;
    this.metadata = dataset.metadata;
    const min = this.metadata.boundingBox.min.map(
        (v, i) => v - this.metadata.offset[i],
      ),
      max = this.metadata.boundingBox.max.map(
        (v, i) => v - this.metadata.offset[i],
      );
    this.root = {
      key: "r",
      box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)),
      type: 2,
      offset: 0n,
      size: BigInt(this.metadata.hierarchy.firstChunkSize),
      children: [],
      level: 0,
    };
    this.nodes.set("r", this.root);
    this.uniforms.zRange.value.set(
      this.metadata.attributes.find((a) => a.name === "position").min[2] -
        this.metadata.offset[2],
      this.metadata.attributes.find((a) => a.name === "position").max[2] -
        this.metadata.offset[2],
    );
    this.fit();
    await this.hierarchy(this.root);
    await this.schedule();
  }
  async hierarchy(node) {
    const b = await this.range("hierarchy.bin", node.offset, node.size);
    if (b.byteLength % 22) throw new Error("层级块长度无效");
    const v = new DataView(b),
      queue = [node];
    for (let i = 0; i < b.byteLength / 22; i++) {
      const n = queue[i];
      if (!n) throw new Error("层级结构无效");
      n.type = v.getUint8(i * 22);
      n.count = v.getUint32(i * 22 + 2, true);
      n.offset = v.getBigUint64(i * 22 + 6, true);
      n.size = v.getBigUint64(i * 22 + 14, true);
      if (n.type === 2) continue;
      const mask = v.getUint8(i * 22 + 1);
      n.children = [];
      for (let c = 0; c < 8; c++)
        if (mask & (1 << c)) {
          const lo = n.box.min.clone(),
            hi = n.box.max.clone(),
            mid = n.box.getCenter(new THREE.Vector3());
          for (let k = 0; k < 3; k++) {
            const axis = ["x", "y", "z"][k];
            if (c & (1 << (2 - k))) lo[axis] = mid[axis];
            else hi[axis] = mid[axis];
          }
          const child = {
            key: n.key + c,
            box: new THREE.Box3(lo, hi),
            children: [],
            level: n.level + 1,
          };
          n.children.push(child);
          this.nodes.set(child.key, child);
          queue.push(child);
        }
    }
  }
  configureViews(elements, onChange) {
    this.onViewChange = onChange;
    this.controls.disconnect();
    this.views = Object.entries(elements).map(([id, element]) => {
      const camera =
        id === "main"
          ? this.camera
          : new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 100000);
      camera.up.set(0, 0, 1);
      const controls =
        id === "main" ? this.controls : new OrbitControls(camera, element);
      if (id === "main") controls.connect(element);
      controls.enableDamping = true;
      controls.enableRotate = id === "main";
      controls.addEventListener("end", () =>
        this.onViewChange?.(this.viewState()),
      );
      return { id, element, camera, controls, locked: id !== "main" };
    });
    this.updateViewSizes();
  }
  updateViewSizes() {
    for (const view of this.views.length
      ? this.views
      : [{ camera: this.camera, element: this.container }]) {
      const aspect =
        view.element.clientWidth / Math.max(1, view.element.clientHeight);
      if (!aspect) continue;
      if (view.camera.isPerspectiveCamera) view.camera.aspect = aspect;
      else {
        const h = view.camera.top - view.camera.bottom;
        view.camera.left = (-h * aspect) / 2;
        view.camera.right = (h * aspect) / 2;
      }
      view.camera.updateProjectionMatrix();
    }
  }
  renderViews() {
    const renderer = this.renderer,
      rect = this.container.getBoundingClientRect();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, rect.width, rect.height);
    renderer.clear();
    const views = this.views.length
      ? this.views
      : [
          {
            id: "main",
            camera: this.camera,
            controls: this.controls,
            element: this.container,
          },
        ];
    for (const view of views) {
      if (
        !view.element.clientWidth ||
        !view.element.clientHeight ||
        (view.id !== "main" && !this.region)
      )
        continue;
      view.controls.update();
      const box = view.element.getBoundingClientRect(),
        viewport = {
          x: box.left - rect.left,
          y: rect.bottom - box.bottom,
          width: box.width,
          height: box.height,
        };
      const u = this.uniforms;
      u.regionEnabled.value = view.id !== "main" && !!this.region;
      if (this.region) {
        u.regionCenter.value.fromArray(this.region.center);
        u.regionHalf.value.fromArray(this.region.half);
        u.regionAngle.value.set(
          Math.cos(this.region.angle),
          Math.sin(this.region.angle),
        );
      }
      if (this.regionHelper) this.regionHelper.visible = view.id === "main";
      renderer.setViewport(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
      );
      renderer.setScissor(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
      );
      renderer.setScissorTest(true);
      if (this.edlEnabled)
        this.edl.render(renderer, this.scene, view.camera, viewport);
      else renderer.render(this.scene, view.camera);
    }
    renderer.setScissorTest(false);
  }
  setRegion(region, fit = true) {
    this.region = region;
    if (this.regionHelper) {
      this.scene.remove(this.regionHelper);
      this.regionHelper.geometry.dispose();
      this.regionHelper.material.dispose();
      this.regionHelper = null;
    }
    if (region) {
      const geometry = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(...region.half.map((v) => v * 2)),
      );
      this.regionHelper = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x65d8cb, depthTest: false }),
      );
      this.regionHelper.position.fromArray(region.center);
      this.regionHelper.rotation.z = region.angle;
      this.scene.add(this.regionHelper);
      if (fit)
        for (const view of this.views.filter((v) => v.id !== "main"))
          this.fit(view.id);
    }
    this.updateViewSizes();
  }
  setPreview(preview) {
    this.preview = preview;
    this.epoch++;
    this.editRequestedAt = performance.now();
    for (const node of this.nodes.values())
      if (node.object) this.applyNode(node).catch(this.onError);
  }
  setTool(tool) {
    for (const view of this.views) {
      view.controls.enabled = tool === "navigate";
      view.controls.enableDamping = tool === "navigate";
      if (tool !== "navigate") view.controls.update();
    }
  }
  setBrush(operation, inputAt = performance.now()) {
    if (!operation) {
      this.brush = null;
      this.pendingBrush = null;
      this.epoch++;
      for (const n of this.nodes.values())
        if (n.object) this.applyNode(n).catch(this.onError);
      return;
    }
    const value = { operation, inputAt: this.pendingBrush?.inputAt ?? inputAt };
    if (this.brush && this.brushFrameEpoch !== this.epoch)
      this.pendingBrush = value;
    else this.dispatchBrush(value);
  }
  dispatchBrush({ operation, inputAt }) {
    const previousEpoch = this.epoch;
    const compatible = !this.brush || this.brush.id === operation.id;
    this.brush = operation;
    this.brushInputAt = inputAt;
    this.epoch++;
    this.editRequestedAt = inputAt;
    for (const n of this.nodes.values())
      if (n.object) {
        if (
          compatible &&
          n.evaluated === previousEpoch &&
          !this.mayAffect(n, operation)
        )
          n.evaluated = this.epoch;
        else this.applyNode(n).catch(this.onError);
      }
  }
  finishBrush(operation) {
    this.brush = null;
    this.pendingBrush = null;
    this.setOperations([...this.operations, operation]);
  }
  setLocked(id, locked) {
    const view = this.views.find((v) => v.id === id);
    if (!view) return;
    view.locked = locked;
    view.controls.enableRotate = !locked;
    if (locked) this.fit(id);
  }
  viewState() {
    return Object.fromEntries(
      this.views.map((v) => [
        v.id,
        {
          position: v.camera.position.toArray(),
          target: v.controls.target.toArray(),
          up: v.camera.up.toArray(),
          zoom: v.camera.zoom,
          locked: v.locked,
          height: v.camera.isOrthographicCamera
            ? v.camera.top - v.camera.bottom
            : null,
        },
      ]),
    );
  }
  restoreViews(states) {
    for (const view of this.views) {
      const state = states?.[view.id];
      if (!state) continue;
      view.camera.position.fromArray(state.position);
      view.controls.target.fromArray(state.target);
      view.camera.up.fromArray(state.up);
      view.camera.zoom = state.zoom;
      view.locked = state.locked;
      view.controls.enableRotate = !state.locked;
      if (state.height && view.camera.isOrthographicCamera) {
        view.camera.top = state.height / 2;
        view.camera.bottom = -state.height / 2;
      }
      view.controls.update();
    }
    this.updateViewSizes();
  }
  workPoint(ndc, z) {
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(...ndc), this.camera);
    if (Math.abs(ray.ray.direction.z) < 1e-5)
      throw new Error("请调整视角后截取");
    const target = new THREE.Vector3();
    return (
      ray.ray
        .intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), target)
        ?.toArray() || null
    );
  }
  fit(viewId = "main") {
    if (!this.root) return;
    if (viewId !== "main") {
      const view = this.views.find((v) => v.id === viewId);
      if (!view || !this.region) return;
      const { center, half, angle } = this.region,
        target = new THREE.Vector3(...center),
        radius = Math.max(...half, 1),
        c = Math.cos(angle),
        s = Math.sin(angle);
      const dir =
        viewId === "top"
          ? new THREE.Vector3(0, 0, 1)
          : viewId === "front"
            ? new THREE.Vector3(s, -c, 0)
            : new THREE.Vector3(c, s, 0);
      view.camera.up.copy(
        viewId === "top"
          ? new THREE.Vector3(-s, c, 0)
          : new THREE.Vector3(0, 0, 1),
      );
      view.camera.position.copy(target).addScaledVector(dir, radius * 5);
      view.controls.target.copy(target);
      const aspect =
          view.element.clientWidth / Math.max(1, view.element.clientHeight),
        width = viewId === "side" ? half[1] : half[0],
        height = viewId === "top" ? half[1] : half[2],
        h = Math.max(height, width / Math.max(0.1, aspect), 0.1) * 1.2;
      view.camera.top = h;
      view.camera.bottom = -h;
      view.camera.near = 0.01;
      view.camera.far = radius * 20;
      view.camera.zoom = 1;
      view.controls.update();
      this.updateViewSizes();
      return;
    }
    const position = this.metadata.attributes.find(
      (a) => a.name === "position",
    );
    const min = new THREE.Vector3(
        ...position.min.map((v, i) => v - this.metadata.offset[i]),
      ),
      max = new THREE.Vector3(
        ...position.max.map((v, i) => v - this.metadata.offset[i]),
      );
    const bounds = new THREE.Box3(min, max),
      sphere = bounds.getBoundingSphere(new THREE.Sphere()),
      size = Math.max(sphere.radius, 1);
    const element =
      this.views.find((v) => v.id === "main")?.element || this.container;
    const aspect = element.clientWidth / Math.max(element.clientHeight, 1);
    this.camera.aspect = aspect;
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2,
      horizontal = Math.atan(Math.tan(vertical) * aspect),
      distance = (size / Math.sin(Math.min(vertical, horizontal))) * 1.08;
    this.controls.target.copy(sphere.center);
    this.camera.position
      .copy(sphere.center)
      .add(
        new THREE.Vector3(0.15, -0.8, 0.95)
          .normalize()
          .multiplyScalar(distance),
      );
    this.camera.near = Math.max(size / 1000, 0.1);
    this.camera.far = distance + size * 30;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  async load(node) {
    node.loading = true;
    this.loading++;
    const dataset = this.dataset;
    try {
      if (node.type === 2) await this.hierarchy(node);
      if (!node.size || !node.count) return;
      const buffer = await this.range("octree.bin", node.offset, node.size);
      const decoded = await this.pool.run(
        "decode",
        {
          buffer,
          metadata: this.metadata,
          count: node.count,
          key: this.nodeKey(node),
        },
        [buffer],
      );
      if (this.disposed || dataset !== this.dataset) return;
      node.data = decoded;
      for (const category of decoded.categories)
        this.observedCategories.add(category);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(decoded.positions, 3),
      );
      geometry.setAttribute("rgb", new THREE.BufferAttribute(decoded.rgb, 3));
      geometry.setAttribute(
        "highlight",
        new THREE.BufferAttribute(new Float32Array(node.count), 1),
      );
      geometry.setAttribute(
        "classificationColor",
        new THREE.BufferAttribute(
          new Float32Array(decoded.positions.length),
          3,
        ),
      );
      node.object = new THREE.Points(geometry, this.material);
      node.object.frustumCulled = false;
      node.object.visible = false;
      this.scene.add(node.object);
      await this.applyNode(node);
      node.used = performance.now();
    } catch (e) {
      if (e.name !== "AbortError" && !this.disposed) {
        node.failed = true;
        this.onError(e);
      }
    } finally {
      node.loading = false;
      this.loading--;
      this.requestSchedule();
    }
  }
  async applyNode(node) {
    if (node.applying) return node.applying;
    node.applying = (async () => {
      while (!this.disposed && node.object && node.evaluated !== this.epoch) {
        const epoch = this.epoch,
          object = node.object,
          start = performance.now();
        const result = await this.pool.run("update", {
          key: this.nodeKey(node),
          operations: this.operations.filter((op) => this.mayAffect(node, op)),
          preview:
            this.preview && this.mayAffect(node, this.preview)
              ? this.preview
              : null,
          classColors: this.classColors,
          forest: {
            valueType:
              this.operations.find(
                (op) => op.type === "createTree" || op.type === "segmentTrees",
              )?.valueType ||
              this.metadata?.attributes.find(
                (a) =>
                  a.name === "treeID" && ["uint16", "uint32"].includes(a.type),
              )?.type,
            view: this.mode === "tree" ? "tree" : "classification",
            activeTree: this.activeTree || 0,
          },
          brush:
            this.brush && this.mayAffect(node, this.brush) ? this.brush : null,
        });
        if (this.disposed || node.object !== object) return;
        if (epoch !== this.epoch) {
          this.metrics.staleResults++;
          continue;
        }
        object.geometry.setAttribute(
          "classificationColor",
          new THREE.BufferAttribute(result.colors, 3),
        );
        object.geometry.setAttribute(
          "highlight",
          new THREE.BufferAttribute(result.highlights, 1),
        );
        object.geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
        node.previewCount = result.highlights.reduce(
          (sum, value) => sum + value,
          0,
        );
        node.evaluated = epoch;
        this.metrics.editMs = performance.now() - start;
        this.metrics.evaluatedPoints += node.count;
      }
    })();
    try {
      await node.applying;
    } finally {
      node.applying = null;
    }
  }
  requestSchedule() {
    if (this.disposed || this.scheduleRequested) return;
    this.scheduleRequested = true;
    requestAnimationFrame(() => {
      this.scheduleRequested = false;
      if (!this.disposed) this.schedule().catch(this.onError);
    });
  }
  nodeKey(node) {
    return `${this.dataset.id}:${node.key}`;
  }
  mayAffect(node, op) {
    if (op.type === "segmentTrees") {
      const g = op.grid;
      return (
        node.box.max.x >= g.origin[0] &&
        node.box.min.x < g.origin[0] + g.width * g.resolution &&
        node.box.max.y >= g.origin[1] &&
        node.box.min.y < g.origin[1] + g.height * g.resolution
      );
    }
    if (!op.selection && ["createTree", "renameTree"].includes(op.type))
      return true;
    this.operationBounds ??= new WeakMap();
    if (op.scope) {
      const bound = regionBounds(op.scope);
      if (
        !node.box.intersectsBox(
          new THREE.Box3(
            new THREE.Vector3(...bound.min),
            new THREE.Vector3(...bound.max),
          ),
        )
      )
        return false;
    }
    if (op.invert) return true;
    if (op.selection?.kind === "brush") {
      const expr = op.selection,
        m = expr.matrix;
      let bounds = this.operationBounds.get(op);
      if (!bounds) {
        bounds = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [x, y, r] of expr.samples) {
          bounds[0] = Math.min(bounds[0], ((x - r) / expr.viewport[0]) * 2 - 1);
          bounds[2] = Math.max(bounds[2], ((x + r) / expr.viewport[0]) * 2 - 1);
          bounds[1] = Math.min(bounds[1], 1 - ((y + r) / expr.viewport[1]) * 2);
          bounds[3] = Math.max(bounds[3], 1 - ((y - r) / expr.viewport[1]) * 2);
        }
        this.operationBounds.set(op, bounds);
      }
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const x of [node.box.min.x, node.box.max.x])
        for (const y of [node.box.min.y, node.box.max.y])
          for (const z of [node.box.min.z, node.box.max.z]) {
            const w = m[3] * x + m[7] * y + m[11] * z + m[15];
            if (w <= 0) return true;
            const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
              py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
      return (
        maxX >= bounds[0] - 1e-7 &&
        minX <= bounds[2] + 1e-7 &&
        maxY >= bounds[1] - 1e-7 &&
        minY <= bounds[3] + 1e-7
      );
    }
    const cached = this.operationBounds.get(op);
    if (cached) return node.box.intersectsBox(cached);
    const expr = op.selection || {
      kind: "screen",
      matrix: op.matrix,
      polygon: op.polygon,
    };
    const bounds = (selection) => {
      if (selection.kind === "union")
        return bounds(selection.children[0]).union(
          bounds(selection.children[1]),
        );
      if (selection.kind === "intersection")
        return bounds(selection.children[0]).intersect(
          bounds(selection.children[1]),
        );
      if (selection.kind === "difference") return bounds(selection.children[0]);
      // Perspective near-plane crossings require conservative inclusion.
      if (selection.kind === "brush")
        return new THREE.Box3(
          new THREE.Vector3(-1e30, -1e30, -1e30),
          new THREE.Vector3(1e30, 1e30, 1e30),
        );
      if (!selection.matrix) return node.box.clone();
      const inverse = new THREE.Matrix4().fromArray(selection.matrix).invert(),
        xs = selection.polygon.map((p) => p[0]),
        ys = selection.polygon.map((p) => p[1]),
        result = new THREE.Box3();
      for (const x of [Math.min(...xs), Math.max(...xs)])
        for (const y of [Math.min(...ys), Math.max(...ys)])
          for (const z of selection.depth || [-1, 1])
            result.expandByPoint(
              new THREE.Vector3(x, y, z).applyMatrix4(inverse),
            );
      return result;
    };
    const box = bounds(expr).expandByScalar(0.00001);
    this.operationBounds.set(op, box);
    return node.box.intersectsBox(box);
  }
  setOperations(operations) {
    if (JSON.stringify(this.operations) === JSON.stringify(operations)) return;
    this.operations = operations;
    this.epoch++;
    this.editRequestedAt = performance.now();
    for (const node of this.nodes.values())
      if (node.object) {
        this.applyNode(node).catch(this.onError);
      }
  }
  setClasses(classes) {
    const colors = Object.fromEntries(classes.map((c) => [c.id, c.color]));
    if (JSON.stringify(colors) === JSON.stringify(this.classColors)) return;
    this.classColors = colors;
    this.epoch++;
    this.editRequestedAt = performance.now();
    for (const node of this.nodes.values())
      if (node.object) this.applyNode(node).catch(this.onError);
  }
  async schedule() {
    if (!this.root || this.disposed) return;
    const active = this.views.length
      ? this.views.filter(
          (v) =>
            v.element.clientWidth &&
            v.element.clientHeight &&
            (v.id === "main" || this.region),
        )
      : [{ camera: this.camera, id: "main" }];
    const frustums = active.map((view) => {
      view.camera.updateMatrixWorld();
      return {
        view,
        frustum: new THREE.Frustum().setFromProjectionMatrix(
          new THREE.Matrix4().multiplyMatrices(
            view.camera.projectionMatrix,
            view.camera.matrixWorldInverse,
          ),
        ),
      };
    });
    const bounds = this.region ? regionBounds(this.region) : null;
    const localBox = bounds
      ? new THREE.Box3(
          new THREE.Vector3(...bounds.min),
          new THREE.Vector3(...bounds.max),
        )
      : null;
    const priorities = new Map();
    const priority = (node) => {
      if (priorities.has(node)) return priorities.get(node);
      const size = node.box.getSize(new THREE.Vector3()).length();
      const value = Math.max(
        ...active.map(
          (view) =>
            size /
            Math.max(
              1,
              view.camera.isOrthographicCamera
                ? (view.camera.top - view.camera.bottom) / view.camera.zoom
                : node.box.distanceToPoint(view.camera.position),
            ),
        ),
      );
      priorities.set(node, value);
      return value;
    };
    const queue = [this.root],
      wanted = [];
    let count = 0;
    while (queue.length) {
      queue.sort((a, b) => priority(b) - priority(a));
      const n = queue.shift();
      if (
        !frustums.some(
          ({ view, frustum }) =>
            frustum.intersectsBox(n.box) &&
            (view.id === "main" || localBox?.intersectsBox(n.box)),
        ) &&
        n !== this.root
      )
        continue;
      if (n.count && count + n.count > this.budget && wanted.length) continue;
      wanted.push(n);
      count += n.count || 0;
      if (n.type !== 2) queue.push(...n.children);
      if (wanted.length > 180) break;
    }
    const keys = new Set(wanted.map((n) => n.key));
    for (const n of this.nodes.values())
      if (n.object)
        n.object.visible = keys.has(n.key) && n.evaluated !== undefined;
    for (const n of wanted) {
      n.used = performance.now();
      if (!n.object && !n.loading && !n.failed && this.loading < 2)
        this.load(n);
    }
    let cached = [...this.nodes.values()].filter((n) => n.data),
      cachedPoints = cached.reduce((s, n) => s + n.count, 0);
    for (const n of cached.sort((a, b) => a.used - b.used))
      if (cachedPoints > this.budget * 2.5 && !keys.has(n.key) && n.object) {
        cachedPoints -= n.count;
        this.scene.remove(n.object);
        n.object.geometry.dispose();
        this.pool.run("forget", { key: this.nodeKey(n) }).catch(() => {});
        delete n.object;
        delete n.data;
      }
    const visible = [...this.nodes.values()].filter((n) => n.object?.visible);
    const intervals = [...this.metrics.frameIntervals].sort((a, b) => a - b);
    this.renderer.domElement.dataset.diagnostics = JSON.stringify({
      sampledAt: Date.now(),
      epoch: this.epoch,
      settled: [...this.nodes.values()].every(
        (n) => !n.object || n.evaluated === this.epoch,
      ),
      loadedNodes: cached.filter((n) => n.data).length,
      loading: this.loading,
      cachedPoints,
      visiblePoints: visible.reduce(
        (sum, n) => sum + n.object.geometry.index.count,
        0,
      ),
      selectedPoints: visible.reduce(
        (sum, n) => sum + (n.previewCount || 0),
        0,
      ),
      readBytes: this.metrics.readBytes,
      editMs: this.metrics.editMs,
      interactionMs: this.metrics.interactionMs,
      frameP95Ms: intervals[Math.floor(intervals.length * 0.95)] || 0,
      staleResults: this.metrics.staleResults,
      frameMs: this.metrics.frameMs,
      views: this.views.filter(
        (v) => v.element.clientWidth && (v.id === "main" || this.region),
      ).length,
      mainCamera: this.selection([], false, "main").matrix,
    });
    this.onStats({
      visible: visible.reduce((s, n) => s + n.object.geometry.index.count, 0),
      nodes: visible.length,
      loading: this.loading,
      cached: cachedPoints,
      source: this.metadata.points,
      metrics: { ...this.metrics },
      observedCategories: [...this.observedCategories].sort((a, b) => a - b),
      epoch: this.epoch,
      settled: [...this.nodes.values()].every(
        (n) => !n.object || n.evaluated === this.epoch,
      ),
    });
  }
  score(n) {
    const views = this.views.filter(
      (v) => v.element.clientWidth && (v.id === "main" || this.region),
    );
    return Math.max(
      ...(views.length ? views.map((v) => v.camera) : [this.camera]).map(
        (camera) =>
          n.box.getSize(new THREE.Vector3()).length() /
          Math.max(
            1,
            camera.isOrthographicCamera
              ? (camera.top - camera.bottom) / camera.zoom
              : n.box.distanceToPoint(camera.position),
          ),
      ),
    );
  }
  selection(polygon, invert = false, viewId = "main", depth = null) {
    const camera =
      this.views.find((v) => v.id === viewId)?.camera || this.camera;
    camera.updateMatrixWorld();
    return {
      polygon,
      matrix: new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .toArray(),
      invert,
      ...(depth ? { depth } : {}),
    };
  }
  setMode(mode) {
    if (!["rgb", "height", "classification", "tree"].includes(mode))
      throw new Error("Unknown color mode");
    const changed =
      this.mode !== mode && (this.mode === "tree" || mode === "tree");
    this.mode = mode;
    this.uniforms.mode.value = {
      rgb: 0,
      height: 1,
      classification: 2,
      tree: 3,
    }[mode];
    if (changed) {
      this.refreshEdits();
    }
  }
  refreshEdits() {
    this.epoch++;
    this.editRequestedAt = performance.now();
    for (const n of this.nodes.values())
      if (n.object) this.applyNode(n).catch(this.onError);
  }
  setActiveTree(id) {
    if (this.activeTree === id) return;
    this.cancelActiveBrush?.();
    this.activeTree = id;
    if (this.mode === "tree") this.refreshEdits();
  }
  clear() {
    this.observedCategories.clear();
    this.pool.clearCommands();
    for (const n of this.nodes.values())
      if (n.object) {
        this.scene.remove(n.object);
        n.object.geometry.dispose();
        this.pool.run("forget", { key: this.nodeKey(n) }).catch(() => {});
      }
    this.nodes.clear();
    this.root = null;
  }
  dispose() {
    this.disposed = true;
    this.abort?.abort();
    this.renderer.setAnimationLoop(null);
    this.resize.disconnect();
    this.controls.dispose();
    this.views
      .filter((v) => v.id !== "main")
      .forEach((v) => v.controls.dispose());
    this.regionHelper?.geometry.dispose();
    this.regionHelper?.material.dispose();
    this.clear();
    this.pool.dispose();
    this.material.dispose();
    this.edl.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
