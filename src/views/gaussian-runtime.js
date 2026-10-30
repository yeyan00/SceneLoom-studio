import { main } from "../../vendor/supersplat/src/main.ts";
import { i18n } from "../../vendor/supersplat/src/ui/localization.ts";
import styles from "../../vendor/supersplat/src/ui/scss/style.scss?inline";
import { Color, Vec3 } from "playcanvas";

// Font-face rules inside a shadow tree are ignored by Chromium. Register only
// the icon font globally; all editor layout and theme rules stay in the tree.
if (!document.querySelector("style[data-supersplat-font]")) {
  const fonts = document.createElement("style");
  fonts.dataset.supersplatFont = "true";
  fonts.textContent = (styles.match(/@font-face\s*\{[^}]+\}/g) || []).join(
    "\n",
  );
  document.head.append(fonts);
}

// A native editor instance. No iframe, page-global editor or second edit history.
export class GaussianRuntime {
  constructor(host, resource, { onStats, onView, locale = "zh-CN" }) {
    this.host = host;
    this.resource = resource;
    this.onStats = onStats;
    this.onView = onView;
    this.locale = locale;
    this.active = true;
    this.frames = 0;
    this.started = performance.now();
    this.view = structuredClone(resource.view);
    this.root = host.shadowRoot || host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent =
      styles +
      `
      :host{display:block;position:relative;contain:layout paint;min-height:0;font-family:Arial,sans-serif;color:#ddd;background:#171717;outline:none}
      #app-container{position:absolute;inset:0;outline:none}
      #canvas-container{position:relative;min-height:0;overflow:hidden}
      #canvas{position:absolute;inset:0;display:block}
      #top-container,#tooltips-container{position:absolute}
      #main-container{min-height:0}
      :host([data-scene-panel="false"]) #scene-panel{display:none}
      #scene-panel{max-height:calc(100% - 130px)}
      input[type=file]{display:none}
      @media(max-width:600px){#app-label{display:none}#scene-panel{max-width:calc(100% - 60px)}#bottom-toolbar{max-width:calc(100% - 12px);overflow-x:auto}}
    `;
    this.root.replaceChildren(style, document.createElement("slot"));
    this.abort = new AbortController();
    document.addEventListener(
      "visibilitychange",
      (this.visibility = () => this.setActive(this.active)),
    );
  }
  async open() {
    if (!navigator.gpu)
      throw new Error(
        "GS 编辑需要支持 WebGPU 的浏览器，请使用新版 Chrome 或 Edge。",
      );
    const context = await main(this.root, this.locale);
    this.context = context;
    if (this.disposed) {
      await this.shutdown();
      return;
    }
    const { editor, scene, events } = context;
    this.canvas = context.editorUI.canvas;
    this.canvas.dataset.gaussian = "true";
    this.canvas.setAttribute("aria-label", "SuperSplat Gaussian editor");
    for (const event of [
      "edit.apply",
      "edit.canUndo",
      "edit.canRedo",
      "selection.changed",
      "splat.stateChanged",
      "doc.saved",
      "view.gaussians",
      "view.centers",
      "view.rings",
    ])
      events.on(event, () => this.publish());
    events.on("postrender", () => {
      this.frames++;
      const now = performance.now();
      if (this.measuring && this.lastRender) {
        this.intervals ??= [];
        this.intervals.push(now - this.lastRender);
        if (this.intervals.length > 180) this.intervals.shift();
      }
      this.lastRender = now;
      if (this.loaded && !this.firstFrameMs)
        this.firstFrameMs = now - this.started;
      this.publish(
        now - (this.lastPublished || 0) > 250 ||
          (!this.reportedReady && this.loaded),
      );
      if (this.loaded && !this.restoring) {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveView(), 400);
      }
    });
    const surface = context.editorUI.canvasContainer.dom;
    surface.addEventListener(
      "pointerdown",
      () => {
        this.measuring = true;
        this.intervals = [];
        this.lastRender = null;
      },
      { signal: this.abort.signal },
    );
    surface.addEventListener(
      "pointerup",
      () => {
        this.measuring = false;
      },
      { signal: this.abort.signal },
    );
    this.setActive(this.active);
    const response = await fetch(this.resource.url, {
      signal: this.abort.signal,
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => ({}))).error ||
          `GS HTTP ${response.status}`,
      );
    const file = new File([await response.blob()], this.resource.name);
    if (this.disposed) return;
    this.restoring = true;
    this.importTask = events.invoke(
      "import",
      [{ filename: file.name, contents: file }],
      false,
      { throwOnError: true },
    );
    await this.importTask;
    if (this.disposed) return;
    if (!editor.layers.list().length)
      throw new Error("没有可显示的 Gaussian 数据");
    await context.editHistory.clear();
    events.fire("doc.saved");
    if (this.resource.encoding !== "supersplat-project")
      await editor.viewport.setView({
        background: new Color().fromString(this.view.background),
        showCenters: false,
      });
    if (this.view.camera)
      await editor.viewport.setCamera({
        position: new Vec3(...this.view.camera.position),
        target: new Vec3(...this.view.camera.target),
      });
    else await this.fit();
    this.restoring = false;
    this.loaded = true;
    this.loadMs = performance.now() - this.started;
    scene.forceRender = true;
    this.publish();
    this.root.getElementById("app-container")?.focus({ preventScroll: true });
  }
  publish(notify = true) {
    if (!this.context || this.disposed) return;
    const { editor, scene, events, editHistory } = this.context;
    const layers = editor.layers.list();
    const sum = (key) => layers.reduce((n, layer) => n + layer[key], 0);
    const data = {
      ready: !!this.loaded,
      active: this.active && !document.hidden,
      frames: this.frames,
      count: sum("total"),
      selected: sum("selected"),
      hidden: sum("hidden"),
      deleted: sum("deleted"),
      dirty: !!events.invoke("scene.dirty"),
      cursor: editHistory.cursor,
      canUndo: editHistory.canUndo(),
      canRedo: editHistory.canRedo(),
      loadMs: this.loadMs || 0,
      firstFrameMs: this.firstFrameMs || 0,
      width: this.canvas.width,
      height: this.canvas.height,
      position: scene.camera.captureFrame().position.toArray(),
      target: this.poseTarget(),
      display: {
        gaussians: events.invoke("view.gaussians"),
        centers: events.invoke("view.centers"),
        rings: events.invoke("view.rings"),
      },
      renderIntervals: this.intervals || [],
      engine: "SuperSplat",
      renderer: "WebGPU",
      gpu: events.invoke("scene.gpu"),
    };
    this.canvas.dataset.diagnostics = JSON.stringify(data);
    this.host.dataset.diagnostics = JSON.stringify(data);
    if (notify) {
      this.reportedReady = !!this.loaded;
      this.lastPublished = performance.now();
      this.onStats(data);
    }
  }
  poseTarget() {
    const p = this.context.events.invoke("camera.getPose").target;
    return [p.x, p.y, p.z];
  }
  async fit() {
    if (this.context && !this.disposed)
      await this.context.editor.viewport.focus("scene");
  }
  async setDisplay(key, value) {
    const names = {
      gaussians: "showGaussians",
      centers: "showCenters",
      rings: "showRings",
    };
    await this.context.editor.viewport.setView({ [names[key]]: value });
    this.publish();
  }
  async saveProject() {
    return this.context.events.invoke("doc.saveAs");
  }
  async export(format) {
    return this.context.events.invoke("scene.export", format);
  }
  async loadProject(file) {
    await this.context.events.invoke("doc.load", file);
    this.publish();
  }
  async setLocale(locale) {
    this.locale = locale;
    if (this.context) await i18n.setLanguage(locale);
  }
  saveView() {
    if (!this.context || this.disposed || !this.loaded) return;
    this.view.camera = {
      position: this.context.scene.camera.captureFrame().position.toArray(),
      target: this.poseTarget(),
    };
    this.view.background = this.context.events.invoke("bgClr").toString(false);
    this.onView(structuredClone(this.view));
  }
  setActive(active) {
    this.active = active;
    if (!this.context || this.disposed) return;
    const visible = active && !document.hidden;
    const { scene, events, toolManager } = this.context;
    if (!visible) {
      toolManager.activate(null);
      events.fire("timeline.playing", false);
      scene.app.renderNextFrame = false;
      this.lastRender = null;
    } else {
      const rect = this.host.getBoundingClientRect();
      scene.canvasResize = {
        width: Math.max(1, Math.round(rect.width * devicePixelRatio)),
        height: Math.max(1, Math.round(rect.height * devicePixelRatio)),
      };
      scene.forceRender = true;
    }
    events.active = visible;
    this.publish();
  }
  async shutdown() {
    if (!this.context || this.shutdownStarted) return;
    this.shutdownStarted = true;
    const { scene, events, editHistory, editorUI } = this.context;
    try {
      await this.importTask?.catch(() => {});
      await scene.commandQueue.enqueue(() => {});
      await editHistory.clear();
      // Remove splats and overlays before the camera they reference.
      for (const element of [...scene.elements].reverse()) element.destroy();
    } finally {
      events.dispose();
      try {
        scene.app.destroy();
      } finally {
        editorUI.appContainer.destroy();
        this.root.replaceChildren();
        delete this.host.dataset.diagnostics;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.saveView();
    this.disposed = true;
    this.abort.abort();
    clearTimeout(this.saveTimer);
    document.removeEventListener("visibilitychange", this.visibility);
    if (this.context) {
      this.context.events.active = false;
      this.context.scene.app.renderNextFrame = false;
    }
    this.shutdownPromise = this.shutdown().catch((e) =>
      console.error("GS dispose failed", e),
    );
  }
}
