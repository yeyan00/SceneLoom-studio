import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { ImplicitTilingPlugin } from "3d-tiles-renderer/core/plugins";
import { CrunchTextures } from './crunch-textures.js';

export class TilesRuntime {
  constructor(host, resource, { onStats, onError, onView }) {
    Object.assign(this, {
      host,
      resource,
      onStats,
      onError,
      onView,
      active: true,
      frames: 0,
      models: new Set(),
      started: performance.now(),
    });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#18212d");
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e8);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.dataset.tiles = "true";
    this.canvas.setAttribute("aria-label", "3D Tiles viewport");
    host.append(this.canvas);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 3));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, -2, 3);
    this.scene.add(light);
    this.tiles = new TilesRenderer(resource.url);
    this.tiles.registerPlugin(new ImplicitTilingPlugin());
    this.tiles.setCamera(this.camera);
    this.tiles.errorTarget = 8;
    // Large OSGB conversions often have hundreds of independent branches
    // under an empty root. Display ready branches without waiting for all
    // siblings to finish or retaining offscreen siblings in memory.
    this.tiles.loadAncestors = false;
    this.tiles.loadSiblings = false;
    // External tileset JSONs also occupy cache entries. A small count limit
    // can fill with hierarchy alone, leaving no room to request mesh tiles.
    // Keep the renderer's count limit and bound resident geometry by bytes.
    this.draco = new DRACOLoader().setDecoderPath("/tiles-decoders/draco/");
    this.ktx = new KTX2Loader()
      .setTranscoderPath("/tiles-decoders/basis/")
      .detectSupport(this.renderer);
    this.tiles.registerPlugin(
      new GLTFExtensionsPlugin({
        plugins: [(this.crunch = new CrunchTextures()).plugin],
        dracoLoader: this.draco,
        ktxLoader: this.ktx,
        meshoptDecoder: MeshoptDecoder,
        autoDispose: false,
      }),
    );
    this.scene.add(this.tiles.group);
    this.tiles.addEventListener("load-model", (e) => {
      this.models.add(e.scene);
      this.applyWireframe(e.scene);
      this.loadMs ??= performance.now() - this.started;
      this.onError("");
    });
    this.tiles.addEventListener("dispose-model", (e) =>
      this.models.delete(e.scene),
    );
    this.tiles.addEventListener("load-error", (e) => {
      if (!this.disposed)
        this.onError(
          `${e.error?.message || "Tile loading failed"}: ${e.url || ""}`,
        );
    });
    this.controls.addEventListener("end", () => {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveView(), 300);
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    document.addEventListener(
      "visibilitychange",
      (this.visibility = () => this.setActive(this.active)),
    );
    this.resize();
    this.tick();
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  initializeBounds() {
    const sphere = new THREE.Sphere();
    if (
      !this.tiles.getBoundingSphere(sphere) ||
      !Number.isFinite(sphere.radius) ||
      sphere.radius <= 0
    )
      return;
    this.origin = sphere.center.clone();
    this.radius = sphere.radius;
    this.tiles.group.position.copy(this.origin).negate();
    this.tiles.group.updateMatrixWorld(true);
    if (this.origin.length() > 6e6 && this.origin.length() < 7e6)
      this.camera.up.copy(this.origin).normalize();
    this.camera.near = Math.max(0.01, this.radius / 100000);
    this.camera.far = Math.max(1000, this.radius * 100);
    this.camera.updateProjectionMatrix();
    this.fit();
    const v = this.resource.view;
    if (v?.position && v?.target) {
      this.camera.position.fromArray(v.position);
      this.controls.target.fromArray(v.target);
      this.controls.update();
    }
    this.initialized = true;
  }
  fit() {
    if (!this.radius) return;
    const up = this.camera.up,
      east = new THREE.Vector3(1, 0, 0);
    if (Math.abs(east.dot(up)) > 0.95) east.set(0, 1, 0);
    east.addScaledVector(up, -east.dot(up)).normalize();
    const north = new THREE.Vector3().crossVectors(up, east);
    const distance =
      (this.radius /
        Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) /
        Math.min(1, this.camera.aspect)) *
      1.12;
    this.camera.position
      .copy(east)
      .addScaledVector(north, -1)
      .addScaledVector(up, 0.8)
      .normalize()
      .multiplyScalar(distance);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
  setWireframe(value) {
    this.wireframe = value;
    this.tiles.forEachLoadedModel((scene) => this.applyWireframe(scene));
  }
  setQuality(errorTarget) {
    this.tiles.errorTarget = errorTarget;
  }
  applyWireframe(scene) {
    scene.traverse((obj) => {
      if (obj.isMesh)
        for (const material of Array.isArray(obj.material)
          ? obj.material
          : [obj.material])
          material.wireframe = !!this.wireframe;
    });
  }
  publish() {
    const data = {
      ready: this.models.size > 0,
      active: this.active && !document.hidden,
      frames: this.frames,
      loaded: this.models.size,
      visible: this.tiles.visibleTiles.size,
      loadMs: this.loadMs || 0,
      width: this.canvas.width,
      height: this.canvas.height,
      origin: this.origin?.toArray(),
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      triangles: this.renderer.info.render.triangles,
      wireframe: !!this.wireframe,
      downloading: this.tiles.stats.downloading,
      parsing: this.tiles.stats.parsing,
      failed: this.tiles.stats.failed,
    };
    this.host.dataset.diagnostics = JSON.stringify(data);
    this.onStats(data);
  }
  tick = () => {
    if (this.disposed || !this.active || document.hidden) return;
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
    if (!this.initialized) this.initializeBounds();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (performance.now() - (this.lastStats || 0) > 150) {
      this.lastStats = performance.now();
      this.publish();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  setActive(active) {
    this.active = active;
    cancelAnimationFrame(this.frame);
    if (active && !document.hidden) {
      this.resize();
      this.tick();
    } else this.saveView();
    this.publish();
  }
  saveView() {
    if (this.initialized && !this.disposed)
      this.onView({
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
      });
  }
  dispose() {
    if (this.disposed) return;
    this.saveView();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.saveTimer);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.controls.dispose();
    this.tiles.dispose();
    this.draco.dispose();
    this.ktx.dispose();
    this.crunch.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
